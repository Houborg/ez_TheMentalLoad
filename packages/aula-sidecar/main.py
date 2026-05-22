import asyncio
import base64
import io
import json
import os
import tempfile
import time
from typing import Any
from uuid import uuid4

import qrcode
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from aula import AulaAuthenticationError, FileTokenStorage
from aula.auth_flow import authenticate

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
                if data.get("status") == "OK" and data.get("confirmation") is True:
                    return data["payload"]["response"], data["payload"]["responseSignature"]
                status = data.get("status", "")
                import asyncio as _asyncio
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

            _sessions[session_id]["status"] = "completed"
            _sessions[session_id].update(tokens)
        except AulaAuthenticationError as e:
            print(f"[auth] AulaAuthenticationError: {e}", flush=True)
            _sessions[session_id]["status"] = "error"
            _sessions[session_id]["error"] = str(e)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[auth] Exception: {e}\n{tb}", flush=True)
            _sessions[session_id]["status"] = "error"
            _sessions[session_id]["error"] = f"Auth error: {e}"
        finally:
            try:
                os.unlink(token_file)
            except OSError:
                pass

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
        )
    elif status == "qr_ready":
        return PollResponse(status="qr_ready", qr_codes=session.get("qr_codes"))
    elif status == "error":
        return PollResponse(status="error", error=session.get("error", "Unknown error"))
    else:
        return PollResponse(status="pending")


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
