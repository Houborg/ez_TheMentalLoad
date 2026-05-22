import asyncio
import json
import os
import tempfile
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from aula import AulaAuthenticationError, FileTokenStorage
from aula.auth_flow import authenticate


app = FastAPI(title="Aula auth sidecar")


class AuthRequest(BaseModel):
    username: str
    password: str
    totp_code: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: str | None = None


@app.post("/authenticate", response_model=AuthResponse)
async def do_authenticate(req: AuthRequest) -> AuthResponse:
    fd, token_file = tempfile.mkstemp(suffix=".json")
    os.close(fd)

    try:
        storage = FileTokenStorage(token_file)

        password = req.password
        totp_code = req.totp_code

        async def get_password() -> str:
            return password

        async def get_totp() -> str:
            return totp_code

        await authenticate(
            req.username,
            storage,
            auth_method="token",
            on_password=get_password,
            on_token_digits=get_totp,
        )

        with open(token_file, "r") as f:
            data = json.load(f)

        # The library stores tokens under a "tokens" key
        tokens = data.get("tokens", data)

        access_token = tokens.get("access_token") or tokens.get("accessToken") or ""
        refresh_token = tokens.get("refresh_token") or tokens.get("refreshToken") or ""
        expires_at = (
            tokens.get("expires_at")
            or tokens.get("expiresAt")
            or tokens.get("expiry")
        )

        if not access_token or not refresh_token:
            raise HTTPException(
                status_code=500,
                detail=f"Missing tokens in storage. Keys found: {list(tokens.keys())}",
            )

        return AuthResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=str(expires_at) if expires_at else None,
        )

    except AulaAuthenticationError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auth error: {e}")
    finally:
        try:
            os.unlink(token_file)
        except OSError:
            pass


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765)
