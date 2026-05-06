---
name: mentalload-deploy
description: 'Deploy or redeploy the Mental Load app on the Testbench server. Use when: setting up mentalload for the first time, fixing a broken deployment, adapting the mentalload compose file for Testbench (Cloudflare tunnel, not Traefik), or understanding why containers are not starting.'
---

# Mental Load — Testbench Deployment

## Key Facts

| Item | Value |
|------|-------|
| Source repo | `/home/mhouborg/ez_TheMentalLoad` on the server |
| Compose file on server | `/home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml` |
| Public URL | `https://mentalload.pl0k.online` |
| Frontend port | `4173` |
| Backend port | `3000` |
| Docker network | `testbench` (external, Cloudflare tunnel lives here) |
| Slug in Testbench DB | `mentalload` |
| Server | `192.168.1.252` · user `mhouborg` · key `~/.ssh/server_key` |

## How Routing Works (Cloudflare, NOT Traefik)

The mentalload source repo (`README_FOR_BOTS.md`) is written for a Traefik-based testbench (`ez_testbench_proxy` network, Docker labels).
**This server uses Cloudflare Tunnel instead.** There are no Traefik labels and no `ez_testbench_proxy` network here.

Routing rule: **any service that joins the `testbench` Docker network is reachable by cloudflared.**
The tunnel ingress rule maps `mentalload.pl0k.online → http://mentalload-frontend:4173`.

You never need Traefik labels. Just:
1. Attach every service to the `testbench` external network.
2. Make sure the Cloudflare tunnel ingress entry exists (Testbench UI → Settings → Tunnel, or `lib/cloudflare.ts`).

## Compose File — Canonical Working Version

The file at `/home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml` is the reference.
Critical differences from the upstream `ez_TheMentalLoad/docker-compose.yml`:

| Upstream (Traefik) | Testbench adaptation |
|---|---|
| `context: .` | `context: /home/mhouborg/ez_TheMentalLoad` |
| `env_file: .env.example` | **Removed** — env vars set inline |
| Service names: `postgres`, `redis` … | Prefixed: `mentalload-postgres`, `mentalload-redis` … |
| Network: `ez_testbench_proxy` | Network: `testbench` |
| Traefik labels | **None needed** |
| `ports:` exposed on host | Only frontend (`4173`) needs a port; backend internal only |
| `NEXT_PUBLIC_WS_URL: ws://localhost:3000/ws` | `wss://mentalload.pl0k.online/ws` |
| `BACKEND_URL: http://backend:3000` | `http://mentalload-backend:3000` |

### Key environment variables

```yaml
# Backend / Worker
PORT: "3000"
PERSISTENCE_DRIVER: postgres
DATABASE_URL: postgresql://postgres:postgres@mentalload-postgres:5432/mental_load
REDIS_URL: redis://mentalload-redis:6379
OLLAMA_URL: http://mentalload-ollama:11434
SMTP_HOST: smtp.simply.dk
SMTP_PORT: "587"
DEFAULT_TIMEZONE: Europe/Copenhagen

# Frontend
BACKEND_URL: http://mentalload-backend:3000
NEXT_PUBLIC_WS_URL: wss://mentalload.pl0k.online/ws   # Must be wss:// — mixed-content otherwise
```

> **NEXT_PUBLIC_WS_URL guardrail**: This is compiled into the client bundle at build time.
> If you change it, you MUST rebuild the frontend image (`--build`). Recreating without building keeps the old value.

## Deploy / Redeploy

### Via Testbench UI (normal path)
1. Open `https://testbench.pl0k.online` → **Managed Apps** → find `mentalload`.
2. Click **Redeploy**. The webhook triggers `docker compose up -d --build --remove-orphans`.
3. Wait ~3–5 min for the build.

### Manual redeploy from PowerShell (when UI fails)
```powershell
# First run: full build
ssh -i "C:\Users\mhhou\.ssh\server_key" mhouborg@192.168.1.252 `
  "docker compose -f /home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d --build --remove-orphans 2>&1"

# Subsequent runs (images already built)
ssh -i "C:\Users\mhhou\.ssh\server_key" mhouborg@192.168.1.252 `
  "docker compose -f /home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d --remove-orphans 2>&1"
```

### "Stale container ID" error
If `docker compose up` exits with `Error response from daemon: No such container: <hash>`, Docker has a stale state reference.
Fix: run `up -d` again **without `--build`**. The images are already built; the second run resolves the reference.

## First-Time Setup Checklist

- [ ] Source repo cloned at `/home/mhouborg/ez_TheMentalLoad`
- [ ] Compose file written at `/home/mhouborg/testbench/TestBench/data/apps/mentalload/docker-compose.yml` with all adaptations above
- [ ] `mentalload` row exists in Testbench SQLite DB (`/data/testbench.db`, table `apps`)
- [ ] Cloudflare tunnel ingress rule: `mentalload.pl0k.online → http://mentalload-frontend:4173`
- [ ] Pull llama3.2:3b into Ollama (takes ~5 min, only needed once):
  ```bash
  docker exec mentalload-ollama ollama pull llama3.2:3b
  ```

## Ollama Model

The `ollama-init` service (`ollama/ollama:latest`) auto-pulls `llama3.2:3b` on startup.
The model data is persisted in volume `mentalload_ollama`. After the first pull, subsequent restarts skip the download.

If the pull is interrupted, run it manually:
```bash
docker exec mentalload-ollama ollama pull llama3.2:3b
```

## Validation Commands

Run after every deployment:
```powershell
# All containers running?
ssh -i "~/.ssh/server_key" mhouborg@192.168.1.252 `
  "docker ps --filter name=mentalload --format '{{.Names}}: {{.Status}}'"

# Frontend accessible from inside the tunnel network?
ssh -i "~/.ssh/server_key" mhouborg@192.168.1.252 `
  "docker exec testbench-cloudflared wget -qO- http://mentalload-frontend:4173 2>&1 | head -3"

# Public URL
curl -I https://mentalload.pl0k.online
```

Expected running containers:
- `mentalload-frontend` — Up
- `mentalload-backend` — Up
- `mentalload-worker` — Up
- `mentalload-postgres` — Up (healthy)
- `mentalload-redis` — Up (healthy)
- `mentalload-ollama` — Up
- `mentalload-ollama-init` — Exited 0 (expected — one-shot pull)

## Compose File Permissions

The compose file is written by the testbench container (uid 999). You cannot `sed -i` it directly as `mhouborg`.
Workarounds:
- Use `docker cp` + `busybox` to overwrite: `docker run --rm -v <dir>:/t -v /tmp/fixed.yml:/s busybox cp /s /t/docker-compose.yml`
- Or `docker cp` the file into the testbench container, edit with node, then `docker cp` back.
- Or update via the Testbench UI edit form.

## Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `env file .env.example not found` | Upstream compose used as-is | Remove all `env_file:` entries; set vars inline |
| Build context errors | `context: .` resolves to app data dir, not source | Change to `context: /home/mhouborg/ez_TheMentalLoad` |
| WebSocket connects but immediately drops | `NEXT_PUBLIC_WS_URL` uses `ws://` on HTTPS site | Rebuild frontend with `wss://mentalload.pl0k.online/ws` |
| Backend unreachable by frontend | Container name mismatch | Frontend must point to `http://mentalload-backend:3000`, not `http://backend:3000` |
| `No such container` during compose up | Stale BuildKit reference | Run `up -d` again without `--build` |
| Container not reachable via tunnel | Service not on `testbench` network | Add `networks: [testbench]` to every service |
