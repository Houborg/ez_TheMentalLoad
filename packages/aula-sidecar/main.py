import asyncio
import base64
import io
import json
import os
import tempfile
import time
from datetime import date
from typing import Any
from uuid import uuid4

import qrcode
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from aula import AulaAuthenticationError, FileTokenStorage
from aula.auth_flow import authenticate, create_client

# ── Diagnostic monkey-patch ───────────────────────────────────────────────────
# Log response URL + body when SAML parsing fails, so we can see what page
# the library is getting instead of SAMLResponse/RelayState hidden inputs.

import aula.auth.mitid_client as _mitid_mod
_orig_step4 = None

async def _patched_step4(self: Any, verification_token: str, authorization_code: str) -> Any:
    from bs4 import BeautifulSoup, Tag
    session_uuid = self._client.cookies.get("SessionUuid", "")
    challenge = self._client.cookies.get("Challenge", "")
    params = {
        "__RequestVerificationToken": verification_token,
        "NewCulture": "",
        "MitIDUseConfirmed": "True",
        "MitIDAuthCode": authorization_code,
        "MitIDAuthenticationCancelled": "",
        "MitIDCoreClientError": "",
        "SessionStorageActiveSessionUuid": session_uuid,
        "SessionStorageActiveChallenge": challenge,
    }
    mitid_base = "https://nemlog-in.mitid.dk"
    for name in dir(_mitid_mod):
        val = getattr(_mitid_mod, name, "")
        if isinstance(val, str) and "nemlog-in" in val:
            mitid_base = val
            break

    response = await self._client.post(f"{mitid_base}/login/mitid", data=params)
    print(f"[step4] url={response.url} status={response.status_code} text={response.text[:300]}", flush=True)

    # Handle inline HTML redirect ("Object moved to /loginoption") — ASP.NET sends this
    # instead of a real 302, so response.url stays on /login/mitid
    is_loginoption = (
        str(response.url).endswith("/loginoption")
        or "/loginoption" in response.text
    )

    if is_loginoption:
        print("[step4] detected /loginoption redirect — handling identity selection", flush=True)
        # If it's an inline redirect, we need to follow it
        if not str(response.url).endswith("/loginoption"):
            loginoption_url = f"{mitid_base}/loginoption"
            response = await self._client.get(loginoption_url)
            print(f"[step4] loginoption GET url={response.url} status={response.status_code}", flush=True)
        soup = await self._handle_login_option_page(response)
    else:
        soup = BeautifulSoup(response.text, features="html.parser")

    relay_state_input = soup.find("input", {"name": "RelayState"})
    saml_response_input = soup.find("input", {"name": "SAMLResponse"})

    print(f"[step4] RelayState found={relay_state_input is not None} SAMLResponse found={saml_response_input is not None}", flush=True)

    if not isinstance(relay_state_input, Tag) or not isinstance(saml_response_input, Tag):
        # Try following any form action or link
        from bs4 import BeautifulSoup as BS
        s2 = BS(response.text, "html.parser")
        links = [a.get("href") for a in s2.find_all("a") if a.get("href")]
        print(f"[step4] SAML not found — links on page: {links}", flush=True)
        raise Exception(f"Could not find SAML data. Page: {response.text[:400]}")

    return {
        "relay_state": str(relay_state_input.get("value", "")),
        "saml_response": str(saml_response_input.get("value", "")),
    }

for _cls_name in dir(_mitid_mod):
    _cls = getattr(_mitid_mod, _cls_name, None)
    if _cls and isinstance(_cls, type) and hasattr(_cls, '_step4_complete_mitid_flow'):
        _orig_step4 = _cls._step4_complete_mitid_flow
        _cls._step4_complete_mitid_flow = _patched_step4
        print(f"[sidecar] monkey-patched _step4 on {_cls_name}", flush=True)
        break

# Also patch the browser client's finalization to log the 400 body
import aula.auth.browser_client as _browser_mod
for _cls_name in dir(_browser_mod):
    _cls = getattr(_browser_mod, _cls_name, None)
    if _cls and isinstance(_cls, type) and hasattr(_cls, 'finalize_authentication_and_get_authorization_code'):
        _orig_finalize = _cls.finalize_authentication_and_get_authorization_code
        async def _patched_finalize(self: Any) -> Any:
            url = f"https://www.mitid.dk/mitid-core-client-backend/v1/authentication-sessions/{self._finalization_session_id}/finalization"
            r = await self._client.put(url)
            print(f"[finalize debug] status={r.status_code} body={r.text[:500]}", flush=True)
            if not r.is_success:
                from aula.auth.browser_client import MitIDError  # type: ignore
                raise MitIDError(f"Failed to retrieve authorization code: HTTP {r.status_code}")
            return r.json()["authorizationCode"]
        _cls.finalize_authentication_and_get_authorization_code = _patched_finalize
        print(f"[sidecar] monkey-patched finalize on {_cls_name}", flush=True)
        break

# Patch _poll_for_app_confirmation to handle empty-body responses (library bug:
# calls r.json() before checking r.is_success)
for _cls_name in dir(_browser_mod):
    _cls = getattr(_browser_mod, _cls_name, None)
    if _cls and isinstance(_cls, type) and hasattr(_cls, '_poll_for_app_confirmation'):
        _orig_poll = _cls._poll_for_app_confirmation
        async def _patched_poll(self: Any, poll_url: str, ticket: str) -> Any:
            while True:
                r = await self._client.post(poll_url, json={"ticket": ticket})
                print(f"[poll debug] status={r.status_code} len={len(r.text)} text={r.text[:200]}", flush=True)
                if not r.is_success:
                    raise Exception(f"Poll failed: HTTP {r.status_code} body={r.text[:200]}")
                if not r.text.strip():
                    raise Exception(f"Poll returned empty body with status {r.status_code}")
                data = r.json()
                status = data.get("status", "")
                confirmation = data.get("confirmation", False)
                if status == "OK" and confirmation is True:
                    return data["payload"]["response"], data["payload"]["responseSignature"]
                import asyncio as _asyncio
                # OK + confirmation:False means app is connected but user hasn't approved yet
                if status == "OK" and confirmation is False:
                    await _asyncio.sleep(0.5)
                    continue
                if status in ("timeout",):
                    await _asyncio.sleep(0.5)
                    continue
                if status == "channel_validation_tqr":
                    self._handle_qr_code_poll(data)
                    await _asyncio.sleep(1)
                    continue
                if status in ("channel_validation_otp", "channel_verified"):
                    await _asyncio.sleep(0.5)
                    continue
                raise Exception(f"Unexpected poll status: {status} data={str(data)[:200]}")
        _cls._poll_for_app_confirmation = _patched_poll
        print(f"[sidecar] monkey-patched _poll_for_app_confirmation on {_cls_name}", flush=True)
        break


def _qr_to_base64_png(qr_obj: Any) -> str:
    """Convert a qrcode.QRCode object (or raw data) to a large base64 PNG."""
    try:
        if isinstance(qr_obj, qrcode.QRCode):
            # Re-create with larger box_size for mobile scanning
            data_str = None
            if hasattr(qr_obj, 'data_list') and qr_obj.data_list:
                data_str = qr_obj.data_list[0].data
                if isinstance(data_str, bytes):
                    data_str = data_str.decode()
            if data_str:
                qr = qrcode.QRCode(version=None, box_size=12, border=4)
                qr.add_data(data_str)
                qr.make(fit=True)
                img = qr.make_image(fill_color="black", back_color="white")
            else:
                img = qr_obj.make_image(fill_color="black", back_color="white")
        elif isinstance(qr_obj, str):
            qr = qrcode.QRCode(version=None, box_size=12, border=4)
            qr.add_data(qr_obj)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
        elif isinstance(qr_obj, dict):
            qr = qrcode.QRCode(version=None, box_size=12, border=4)
            qr.add_data(json.dumps(qr_obj, separators=(",", ":")))
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
        else:
            img = qrcode.make(str(qr_obj))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        return f"error:{e}"


app = FastAPI(title="Aula auth sidecar")

# In-memory session store: session_id -> state dict
_sessions: dict[str, dict[str, Any]] = {}
SESSION_TTL = 300  # 5 minutes


# ── Models ────────────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    username: str


class StartResponse(BaseModel):
    session_id: str


class PollResponse(BaseModel):
    status: str          # 'pending' | 'qr_ready' | 'completed' | 'error'
    qr_codes: list[Any] | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    expires_at: str | None = None
    error: str | None = None
    token_data: dict[str, Any] | None = None  # full storage blob for future API calls


class FetchDataRequest(BaseModel):
    token_data: dict[str, Any]
    child_ids: list[int] = []
    from_date: str = ""
    to_date: str = ""
    fetch_posts: bool = True
    fetch_messages: bool = True
    fetch_weekplan: bool = True
    fetch_mu_tasks: bool = False
    fetch_presence: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_tokens(token_file: str) -> dict[str, str]:
    with open(token_file, "r") as f:
        data = json.load(f)
    tokens = data.get("tokens", data)
    return {
        "access_token": tokens.get("access_token") or tokens.get("accessToken") or "",
        "refresh_token": tokens.get("refresh_token") or tokens.get("refreshToken") or "",
        "expires_at": str(tokens.get("expires_at") or tokens.get("expiresAt") or ""),
    }


def _cleanup_old_sessions() -> None:
    now = time.time()
    expired = [k for k, v in _sessions.items() if now - v.get("created_at", 0) > SESSION_TTL]
    for k in expired:
        del _sessions[k]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/authenticate/start", response_model=StartResponse)
async def start_auth(req: StartRequest) -> StartResponse:
    _cleanup_old_sessions()
    session_id = str(uuid4())
    _sessions[session_id] = {
        "status": "pending",
        "created_at": time.time(),
    }

    fd, token_file = tempfile.mkstemp(suffix=".json")
    os.close(fd)

    async def run_auth() -> None:
        try:
            storage = FileTokenStorage(token_file)
            captured_qr: list[Any] = []

            def on_qr(*args: Any) -> None:
                # Library calls this synchronously — must NOT be async
                # Called as on_qr(qr1, qr2) with two positional args
                qr_list = list(args[0]) if len(args) == 1 and isinstance(args[0], (list, tuple)) else list(args)
                captured_qr.clear()
                captured_qr.extend(qr_list)
                _sessions[session_id]["status"] = "qr_ready"
                _sessions[session_id]["qr_codes"] = [
                    _qr_to_base64_png(q) for q in qr_list
                ]

            await authenticate(
                req.username,
                storage,
                auth_method="app",
                on_qr_codes=on_qr,
            )

            tokens = _extract_tokens(token_file)
            print(f"[auth] token keys: {list(tokens.keys())} access_token={'yes' if tokens['access_token'] else 'empty'}", flush=True)
            if not tokens["access_token"]:
                raise ValueError(f"Empty access_token. Keys: {list(tokens.keys())}")

            # Read full token_data — needed to reconstruct Python client for future API calls
            with open(token_file, "r") as f:
                token_data = json.load(f)

            # Fetch children using the library's API client (avoids 410 from TypeScript REST client)
            children: list[dict[str, Any]] = []
            try:
                api_client = await create_client(token_data)
                profile = await api_client.get_profile()
                for child in profile.children or []:
                    children.append({
                        "id": child.id,
                        "name": child.name,
                        "institutionName": child.institution_name,
                    })
                print(f"[auth] fetched {len(children)} children: {[c['name'] for c in children]}", flush=True)
                await api_client.close()
            except Exception as ce:
                print(f"[auth] getChildren via library failed: {ce}", flush=True)

            _sessions[session_id]["status"] = "completed"
            _sessions[session_id].update(tokens)
            _sessions[session_id]["children"] = children
            _sessions[session_id]["token_data"] = token_data  # full blob for future API calls
        except AulaAuthenticationError as e:
            try: os.unlink(token_file)
            except OSError: pass
            print(f"[auth] AulaAuthenticationError: {e}", flush=True)
            _sessions[session_id]["status"] = "error"
            _sessions[session_id]["error"] = str(e)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[auth] Exception: {e}\n{tb}", flush=True)
            _sessions[session_id]["status"] = "error"
            _sessions[session_id]["error"] = f"Auth error: {e}"
            try: os.unlink(token_file)
            except OSError: pass

    asyncio.create_task(run_auth())
    return StartResponse(session_id=session_id)


@app.get("/authenticate/poll/{session_id}", response_model=PollResponse)
async def poll_auth(session_id: str) -> PollResponse:
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    status = session.get("status", "pending")

    if status == "completed":
        return PollResponse(
            status="completed",
            access_token=session.get("access_token"),
            refresh_token=session.get("refresh_token"),
            expires_at=session.get("expires_at"),
            qr_codes=session.get("children"),
            token_data=session.get("token_data"),
        )
    elif status == "qr_ready":
        return PollResponse(status="qr_ready", qr_codes=session.get("qr_codes"))
    elif status == "error":
        return PollResponse(status="error", error=session.get("error", "Unknown error"))
    else:
        return PollResponse(status="pending")


def _iso_or_none(v: Any) -> str | None:
    """Convert datetime/date to ISO string, return None for empty/None."""
    if v is None:
        return None
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    s = str(v).strip()
    return s or None


def _target_week_iso() -> tuple[str, date]:
    """Return ('YYYY-Wnn', monday_date) for the relevant school week.

    Mon-Fri  → current week.
    Sat-Sun  → next week (so we always show an upcoming school week, never weekend dead-air).
    """
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    if today.weekday() <= 4:  # 0=Mon..4=Fri
        monday = today - timedelta(days=today.weekday())
    else:
        monday = today + timedelta(days=(7 - today.weekday()))
    iso = monday.isocalendar()
    return f"{iso.year}-W{iso.week:02d}", monday


def _normalize_lessons(child_id: int, source: str, lessons_raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert source-specific lesson dicts into the canonical sidecar shape.

    Input items are already pre-shaped by the source-specific fetch helpers
    (Task 3) — this just sorts and assigns the seq field.

    Sort key within (childId, date): (startTime ?? '99:99', title) — keeps
    aula_id stable across resyncs regardless of library iteration order.
    """
    by_day: dict[str, list[dict[str, Any]]] = {}
    for lesson in lessons_raw:
        by_day.setdefault(lesson["date"], []).append(lesson)

    out: list[dict[str, Any]] = []
    for day, items in by_day.items():
        items.sort(key=lambda x: (x.get("startTime") or "99:99", x.get("title") or ""))
        for seq, lesson in enumerate(items):
            out.append({
                "childId": child_id,
                "date": day,
                "startTime": lesson.get("startTime"),
                "endTime": lesson.get("endTime"),
                "title": lesson.get("title") or "",
                "description": lesson.get("description"),
                "source": source,
                "seq": seq,
            })
    return out


# ── Weekplan source-specific fetchers ───────────────────────────────────────
#
# Profile context contract (probed 2026-05-23):
#   profile_context["data"]["userId"]                                  → session_uuid (str)
#   client.get_profile().children[i]._raw["userId"]                    → unilogin per child
#   client.get_profile().children[i]._raw["institutionProfile"]
#                       ["institutionCode"]                            → institution code per child
#
# Widgets are matched by name (case-insensitive substring) since multiple
# widgets can share a supplier (UVDATA has several MinUddannelse widgets).
#
# If the library API changes and any of these paths break, the per-source
# fetcher catches the KeyError/AttributeError and returns [].

async def _resolve_session_and_filters(client: Any) -> dict[str, Any] | None:
    """Pull session_uuid, institution_filter, child unilogins, widget_ids in one shot.

    Returns None if the context can't be loaded — caller skips the whole weekplan block.
    """
    try:
        profile = await client.get_profile()
        profile_context = await client.get_profile_context()
        widgets = await client.get_widgets()
    except Exception as e:
        print(f"[fetch-data] weekplan: cannot load profile context: {e}", flush=True)
        return None

    try:
        session_uuid = profile_context["data"]["userId"]
    except (KeyError, TypeError) as e:
        print(f"[fetch-data] weekplan: session_uuid missing from profile_context: {e}", flush=True)
        return None

    institution_codes: list[str] = []
    unilogin_by_child_id: dict[int, str] = {}
    for child in profile.children or []:
        raw = child._raw or {}
        unilogin = raw.get("userId", "")
        if unilogin:
            unilogin_by_child_id[int(child.id)] = unilogin
        inst_code = raw.get("institutionProfile", {}).get("institutionCode", "")
        if inst_code and str(inst_code) not in institution_codes:
            institution_codes.append(str(inst_code))

    # Match widgets by name substring (case-insensitive)
    def widget_id_by_name_match(*needles: str) -> str | None:
        for w in widgets:
            name = (w.name or "").lower()
            if any(n in name for n in needles):
                return w.widget_id
        return None

    widget_id_by_kind = {
        "meebook": widget_id_by_name_match("meebook"),
        "easyiq": widget_id_by_name_match("easyiq"),
        "ugeplan": widget_id_by_name_match("ugenoter", "ugeplan"),
    }

    return {
        "session_uuid": session_uuid,
        "institution_filter": institution_codes,
        "unilogin_by_child_id": unilogin_by_child_id,
        "widget_id_by_kind": widget_id_by_kind,
    }


async def _fetch_meebook(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    if not unilogin:
        return []
    try:
        plans = await client.get_meebook_weekplan(
            child_filter=[unilogin],
            institution_filter=ctx["institution_filter"],
            week=week,
            session_uuid=ctx["session_uuid"],
        )
    except Exception as e:
        print(f"[fetch-data] weekplan meebook child {child_id}: {e}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for plan in plans or []:
        for day in plan.week_plan or []:
            for task in day.tasks or []:
                out.append({
                    "date": day.date,
                    "title": task.title or task.type,
                    "description": task.content or None,
                    # Meebook does not carry per-lesson times
                })
    return out


async def _fetch_easyiq(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    if not unilogin:
        return []
    try:
        appts = await client.get_easyiq_weekplan(
            week=week,
            session_uuid=ctx["session_uuid"],
            institution_filter=ctx["institution_filter"],
            child_id=unilogin,
        )
    except Exception as e:
        print(f"[fetch-data] weekplan easyiq child {child_id}: {e}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for a in appts or []:
        start = a.start or ""
        end = a.end or ""
        if "T" in start:
            date_part, _, start_time = start.partition("T")
        else:
            date_part, start_time = start[:10], ""
        if "T" in end:
            _, _, end_time = end.partition("T")
        else:
            end_time = ""
        out.append({
            "date": date_part,
            "startTime": start_time[:5] if start_time else None,
            "endTime": end_time[:5] if end_time else None,
            "title": a.title or "",
            "description": a.description or None,
        })
    return out


async def _fetch_ugeplan(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    widget_id = ctx["widget_id_by_kind"].get("ugeplan")
    if not (unilogin and widget_id):
        return []
    try:
        persons = await client.get_ugeplan(
            widget_id=widget_id,
            child_filter=[unilogin],
            institution_filter=ctx["institution_filter"],
            week=week,
            session_uuid=ctx["session_uuid"],
        )
    except Exception as e:
        print(f"[fetch-data] weekplan ugeplan child {child_id}: {e}", flush=True)
        return []
    # MUWeeklyPerson does not expose structured lessons — only a weekly letter blob.
    # The actual content lives at _raw["institutioner"][i]["ugebreve"][j]["indhold"]
    # (Danish field names: institutioner=institutions, ugebreve=weekly-letters, indhold=content).
    # Treat each ugebrev as a single "lesson" tagged for Monday of the target week.
    target_monday_iso = ctx.get("target_monday_iso")
    if not target_monday_iso:
        print(f"[fetch-data] weekplan ugeplan child {child_id}: target_monday_iso missing from ctx", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for p in persons or []:
        raw = p._raw or {}
        for inst in raw.get("institutioner", []) or []:
            inst_name = inst.get("navn", "")
            for ub in inst.get("ugebreve", []) or []:
                body = ub.get("indhold") or ""
                if not body:
                    continue
                klass = ub.get("tilknytningNavn", "")
                title = f"Ugeplan {klass}" if klass else "Ugeplan"
                if inst_name:
                    title = f"{title} ({inst_name})"
                out.append({
                    "date": target_monday_iso,
                    "title": title,
                    "description": body,
                })
    return out


# ── MU tasks + presence ─────────────────────────────────────────────────────
#
# Field names below are educated guesses based on the patterns in other Aula
# library models (e.g. CalendarEvent uses snake_case attributes like
# `start_datetime`, `institution_profile_id`). Runtime introspection should
# confirm them once the sidecar runs against a real account. Each `getattr`
# falls back to None / sensible default, and the whole helper is wrapped in
# try/except so a wrong attribute name degrades to an empty list instead of
# breaking /fetch-data.

_PRESENCE_LABELS = {
    "tilstede": "Tilstede",
    "ikke_ankommet": "Ikke ankommet",
    "hentet": "Hentet",
    "syg": "Syg",
    "ferie": "Ferie",
    "fri": "Fri",
}


def _date_only(v: Any) -> str:
    """Normalize a date/datetime/string to 'YYYY-MM-DD'. Returns '' for None or unparseable values."""
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    return str(v).strip()[:10]


def _hhmm(v: Any) -> str | None:
    """Normalize a time/datetime/string to 'HH:MM'. Returns None for missing values.

    Uses isoformat for time-like objects so a datetime renders as '2026-05-24T08:02:00' → '08:02'
    after splitting on 'T'. Plain strings like '08:02:15' get truncated to first 5 chars.
    """
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        s = v.isoformat()
        # datetime → split on 'T' first so we get the time half, then truncate to HH:MM
        return s.split("T", 1)[-1][:5] if "T" in s else s[:5]
    s = str(v).strip()
    return s[:5] if s else None


async def _fetch_mu_tasks(client: Any, _child_ids: list[int]) -> list[dict[str, Any]]:
    """Returns list of normalized mu_task dicts, one per task per child.

    The `_child_ids` parameter is unused (the library scopes tasks to the
    authenticated user's children automatically) but kept for call-site symmetry
    with the other `_fetch_*` helpers.
    """
    out: list[dict[str, Any]] = []
    try:
        tasks = await client.get_mu_tasks()
    except Exception as e:
        print(f"[fetch-data] mu_tasks failed: {type(e).__name__}: {e}", flush=True)
        return out
    for t in tasks or []:
        out.append({
            "childId": getattr(t, "child_id", None) or getattr(t, "institution_profile_id", None),
            "id": str(getattr(t, "id", "") or getattr(t, "uuid", "")),
            "title": getattr(t, "title", "") or getattr(t, "name", "") or "",
            "subject": getattr(t, "subject", None),
            "dueDate": _date_only(getattr(t, "due_date", None) or getattr(t, "deadline", None)),
            "description": getattr(t, "description", "") or getattr(t, "body", "") or "",
            "status": getattr(t, "status", "open"),
            "url": getattr(t, "url", None),
        })
    print(f"[fetch-data] mu_tasks={len(out)}", flush=True)
    return out


async def _fetch_presence(client: Any, child_ids: list[int]) -> list[dict[str, Any]]:
    """Returns list of presence dicts, one per child."""
    from datetime import datetime, timezone
    out: list[dict[str, Any]] = []
    try:
        states = await client.get_presence_states(child_ids=child_ids)
    except Exception as e:
        print(f"[fetch-data] presence failed: {type(e).__name__}: {e}", flush=True)
        return out
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    for s in states or []:
        raw_status = getattr(s, "status", None) or getattr(s, "state", None)
        # Default to 'ukendt' (unknown) — labelling a missing state as 'fri' (holiday)
        # would be misleading.
        status = (raw_status or "ukendt").lower().replace(" ", "_")
        label = getattr(s, "status_label", None) or _PRESENCE_LABELS.get(status, status.title())
        entry_time = getattr(s, "entry_time", None) or getattr(s, "checked_in_at", None)
        exit_time = getattr(s, "exit_time", None) or getattr(s, "checked_out_at", None)
        out.append({
            "childId": getattr(s, "child_id", None) or getattr(s, "institution_profile_id", None),
            "status": status,
            "statusLabel": label,
            "entryTime": _hhmm(entry_time),
            "exitTime": _hhmm(exit_time),
            "comment": getattr(s, "comment", None),
            "asOf": now_iso,
        })
    print(f"[fetch-data] presence={len(out)}", flush=True)
    return out


@app.post("/fetch-data")
async def fetch_data(req: FetchDataRequest) -> dict:
    """Fetch Aula data using the Python library client (bypasses REST API auth issues)."""
    try:
        from datetime import datetime, timezone
        client = await create_client(req.token_data)
        result: dict[str, Any] = {
            "calendar_events": [],
            "weekplan_lessons": [],
            "posts": [],
            "messages": [],
            "mu_tasks": [],
            "presence": [],
        }

        # Parse date range once
        start_dt = end_dt = None
        if req.from_date and req.to_date:
            try:
                start_dt = datetime.fromisoformat(req.from_date).replace(tzinfo=timezone.utc) if 'T' not in req.from_date else datetime.fromisoformat(req.from_date)
                end_dt = datetime.fromisoformat(req.to_date).replace(tzinfo=timezone.utc) if 'T' not in req.to_date else datetime.fromisoformat(req.to_date)
            except Exception as e:
                print(f"[fetch-data] date parse error: {e}", flush=True)

        # Calendar events per child (library expects list[int] + datetime)
        if req.child_ids and start_dt and end_dt:
            for child_id in req.child_ids:
                try:
                    events = await client.get_calendar_events(
                        institution_profile_ids=[child_id],
                        start=start_dt,
                        end=end_dt,
                    )
                    for ev in events or []:
                        result["calendar_events"].append({
                            "id": str(getattr(ev, 'id', '')),
                            "title": getattr(ev, 'title', '') or '',
                            "startTime": _iso_or_none(getattr(ev, 'start_datetime', None)) or '',
                            "endTime": _iso_or_none(getattr(ev, 'end_datetime', None)) or '',
                            "allDay": False,
                            "location": getattr(ev, 'location', None),
                            "childId": child_id,
                        })
                except Exception as e:
                    print(f"[fetch-data] calendar events for child {child_id}: {e}", flush=True)

        # Weekplan — replaces daily_overview (item 3 from MentalLoad-Issues)
        if req.fetch_weekplan and req.child_ids:
            week, monday = _target_week_iso()
            ctx_extras = await _resolve_session_and_filters(client)
            if ctx_extras is None:
                print("[fetch-data] weekplan: skipped (no profile context)", flush=True)
            else:
                ctx_extras["target_monday_iso"] = monday.isoformat()
                for child_id in req.child_ids:
                    for source_name, fetcher in (
                        ("meebook", _fetch_meebook),
                        ("easyiq", _fetch_easyiq),
                        ("ugeplan", _fetch_ugeplan),
                    ):
                        lessons_raw = await fetcher(client, ctx_extras, child_id, week)
                        if lessons_raw:
                            print(f"[fetch-data] weekplan child={child_id} source={source_name} lessons={len(lessons_raw)}", flush=True)
                            result["weekplan_lessons"].extend(
                                _normalize_lessons(child_id, source_name, lessons_raw)
                            )
                            break

        # Posts — library requires institution_profile_ids
        if req.fetch_posts and req.child_ids:
            try:
                posts = await client.get_posts(institution_profile_ids=req.child_ids)
                for p in posts or []:
                    result["posts"].append({
                        "id": str(getattr(p, 'id', '')),
                        "title": getattr(p, 'title', None),
                        "body": getattr(p, 'content_html', None) or '',
                        "author": getattr(p, 'owner', None),
                        "publishedAt": _iso_or_none(getattr(p, 'timestamp', None) or getattr(p, 'publish_at', None)),
                    })
            except Exception as e:
                print(f"[fetch-data] posts: {e}", flush=True)

        # Messages — get threads, fetch latest message body per thread
        if req.fetch_messages:
            try:
                threads = await client.get_message_threads()
                for t in threads or []:
                    tid = str(getattr(t, 'thread_id', '') or getattr(t, 'id', ''))
                    body = ''
                    try:
                        msgs = await client.get_messages_for_thread(thread_id=tid, limit=1)
                        if msgs:
                            body = getattr(msgs[0], 'content_html', '') or ''
                    except Exception as inner:
                        print(f"[fetch-data] messages for thread {tid}: {inner}", flush=True)
                    result["messages"].append({
                        "id": tid,
                        "threadId": tid,
                        "subject": getattr(t, 'subject', None),
                        "body": body,
                        "author": None,
                        "sentAt": None,
                    })
            except Exception as e:
                print(f"[fetch-data] messages: {e}", flush=True)

        # MU tasks (homework) — opt-in
        if req.fetch_mu_tasks:
            result["mu_tasks"] = await _fetch_mu_tasks(client, req.child_ids)

        # Presence (check-in/out state) — opt-in
        if req.fetch_presence and req.child_ids:
            result["presence"] = await _fetch_presence(client, req.child_ids)

        await client.close()
        print(f"[fetch-data] events={len(result['calendar_events'])} weekplan={len(result['weekplan_lessons'])} posts={len(result['posts'])} msgs={len(result['messages'])} mu_tasks={len(result['mu_tasks'])} presence={len(result['presence'])}", flush=True)
        return result

    except Exception as e:
        import traceback
        print(f"[fetch-data] error: {e}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
