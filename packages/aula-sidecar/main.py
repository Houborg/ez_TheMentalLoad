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
    from bs4 import BeautifulSoup
    import httpx as _httpx
    try:
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
        import re
        mitid_base = "https://nemlog-in.mitid.dk"
        for name in dir(_mitid_mod):
            val = getattr(_mitid_mod, name, "")
            if isinstance(val, str) and "nemlog-in" in val:
                mitid_base = val
                break
        response = await self._client.post(f"{mitid_base}/login/mitid", data=params)
        print(f"[step4 debug] response.url={response.url}", flush=True)
        print(f"[step4 debug] response text (first 800): {response.text[:800]}", flush=True)
    except Exception as e:
        print(f"[step4 debug] exception: {e}", flush=True)
    return await _orig_step4(self, verification_token, authorization_code)

for _cls_name in dir(_mitid_mod):
    _cls = getattr(_mitid_mod, _cls_name, None)
    if _cls and isinstance(_cls, type) and hasattr(_cls, '_step4_complete_mitid_flow'):
        _orig_step4 = _cls._step4_complete_mitid_flow
        _cls._step4_complete_mitid_flow = _patched_step4
        print(f"[sidecar] monkey-patched _step4 on {_cls_name}", flush=True)
        break


def _qr_to_base64_png(qr_obj: Any) -> str:
    """Convert a qrcode.QRCode object (or raw data) to a base64 PNG string."""
    try:
        if isinstance(qr_obj, qrcode.QRCode):
            img = qr_obj.make_image(fill_color="black", back_color="white")
        elif isinstance(qr_obj, str):
            img = qrcode.make(qr_obj)
        elif isinstance(qr_obj, dict):
            img = qrcode.make(json.dumps(qr_obj, separators=(",", ":")))
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
            if not tokens["access_token"]:
                raise ValueError(f"Empty access_token. Keys: {list(tokens.keys())}")

            _sessions[session_id]["status"] = "completed"
            _sessions[session_id].update(tokens)
        except AulaAuthenticationError as e:
            _sessions[session_id]["status"] = "error"
            _sessions[session_id]["error"] = str(e)
        except Exception as e:
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
