import asyncio
import json
import os
import tempfile
import time
from typing import Any
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from aula import AulaAuthenticationError, FileTokenStorage
from aula.auth_flow import authenticate


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

            async def on_qr(qr_list: list[Any]) -> None:
                captured_qr.clear()
                captured_qr.extend(qr_list)
                _sessions[session_id]["status"] = "qr_ready"
                _sessions[session_id]["qr_codes"] = [
                    # Convert to serialisable form
                    q if isinstance(q, (str, dict)) else str(q)
                    for q in qr_list
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
