#!/usr/bin/env python3
"""
ez_TheMentalLoad — Production Update Webhook
============================================
Runs on the HOST (not inside a container).
Started automatically by deploy/deploy.sh after each successful deployment.

Listens on 127.0.0.1:9191 (never exposed to the internet).
Validates a shared secret, then triggers deploy/deploy.sh in the background.

Environment variables (read from deploy/.env.production automatically):
  UPDATE_WEBHOOK_SECRET  — shared secret sent in the Authorization: Bearer header
  UPDATE_WEBHOOK_PORT    — override listen port (default: 9191)
"""

import http.server
import json
import logging
import os
import subprocess
import sys
import threading
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DEPLOY_SCRIPT = REPO_ROOT / "deploy" / "deploy.sh"
ENV_FILE = REPO_ROOT / "deploy" / ".env.production"

logging.basicConfig(
    level=logging.INFO,
    format="[update-webhook] %(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("update-webhook")


def load_env_file(path: Path) -> dict[str, str]:
    """Parse key=value pairs from a .env file, ignoring comments and blank lines."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


# Load secret from .env.production (override with real env var if set)
_file_env = load_env_file(ENV_FILE)
SECRET: str = os.environ.get(
    "UPDATE_WEBHOOK_SECRET",
    _file_env.get("UPDATE_WEBHOOK_SECRET", ""),
)
PORT: int = int(os.environ.get("UPDATE_WEBHOOK_PORT", _file_env.get("UPDATE_WEBHOOK_PORT", "9191")))

if not SECRET:
    log.warning(
        "UPDATE_WEBHOOK_SECRET is not set — all requests will be rejected. "
        "Add UPDATE_WEBHOOK_SECRET=<random-string> to deploy/.env.production"
    )

_deploy_lock = threading.Lock()
_deploy_running = False


def run_deploy() -> None:
    global _deploy_running
    log.info("Starting deploy/deploy.sh ...")
    try:
        result = subprocess.run(
            ["bash", str(DEPLOY_SCRIPT)],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            log.info("deploy.sh finished successfully")
        else:
            log.error("deploy.sh exited with code %d\n%s", result.returncode, result.stdout[-4000:])
    except Exception as exc:
        log.exception("Unexpected error running deploy.sh: %s", exc)
    finally:
        _deploy_running = False


class Handler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"ok": True, "service": "update-webhook"})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        global _deploy_running

        if self.path != "/update":
            self._send_json(404, {"error": "not found"})
            return

        if not SECRET:
            self._send_json(503, {"error": "Webhook not configured (no secret set)"})
            return

        auth = self.headers.get("Authorization", "")
        if auth != f"Bearer {SECRET}":
            log.warning("Rejected request — bad secret from %s", self.client_address[0])
            self._send_json(401, {"error": "unauthorized"})
            return

        with _deploy_lock:
            if _deploy_running:
                self._send_json(409, {"ok": False, "message": "A deploy is already in progress"})
                return
            _deploy_running = True

        log.info("Deploy triggered by authenticated request")
        threading.Thread(target=run_deploy, daemon=True).start()

        self._send_json(202, {
            "ok": True,
            "message": "Deploy triggered. Containers will rebuild and restart in ~2–3 minutes.",
        })

    def log_message(self, fmt: str, *args) -> None:  # silence default access log
        pass


if __name__ == "__main__":
    log.info("Starting on 127.0.0.1:%d  (repo: %s)", PORT, REPO_ROOT)
    log.info("Secret configured: %s", "yes" if SECRET else "NO — webhook will reject all requests")
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        sys.exit(0)
