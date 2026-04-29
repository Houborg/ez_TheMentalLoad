# EZ Testbench Deployment README For Bots

This file is for any agent or automation that needs to deploy another project onto this test bench.

## Start Here

1. Read `.github/skills/ez-testbench-deployment/SKILL.md`.
2. Read `DEPLOYMENT_GUIDELINES.md` if you need the longer safety rules.
3. Treat this repository as shared infrastructure. Do not casually edit core services to deploy an app.

## Preferred Deployment Model

Deploy the application from its own repository.

The app repository should provide its own `compose.yml` and connect to the shared Docker networks that already exist on the server:

- `ez_testbench_proxy` for Traefik access
- `ez_testbench_monitoring` if the app exposes Prometheus metrics

Use Traefik Docker labels inside the app's own compose file. That keeps routing next to the app and avoids stale static routes in this repository.

## Minimum Compose Pattern

```yaml
services:
  my-app:
    image: registry.example.com/my-app:1.2.3
    container_name: ez-my-app
    restart: unless-stopped
    env_file:
      - .env
    labels:
      - traefik.enable=true
      - traefik.docker.network=ez_testbench_proxy
      - traefik.http.routers.my-app.rule=Host(`my-app.${BASE_DOMAIN}`)
      - traefik.http.routers.my-app.entrypoints=web,websecure
      - traefik.http.routers.my-app.tls=true
      - traefik.http.services.my-app.loadbalancer.server.port=3000
    networks:
      - proxy
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M

networks:
  proxy:
    external: true
    name: ez_testbench_proxy
```

## When You Are Allowed To Edit This Repository

Edit this repository only for shared-infrastructure concerns such as:

- adding a Homepage tile in `dashboard/homepage/services.yaml`
- adding monitoring config for a shared system component
- fixing Traefik core behavior
- adding a temporary file-provider route for an external app that cannot expose Docker labels

Do not use this repository as the default place to define app containers.

## If You Must Add A Static Traefik Route

Only do this for externally managed apps.

Requirements:

1. Add both `web` and `websecure` routers.
2. Use the exact live container DNS name and port.
3. Confirm the target container is actually running, not just created.
4. Record the owning project and backend target in your PR or task note.

## Required Validation Commands

Run all of these after deployment:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker ps -a --format "table {{.Names}}\t{{.Status}}" | grep my-app
docker inspect --format='{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' ez-my-app
curl -I -H 'Host: my-app.${BASE_DOMAIN}' http://127.0.0.1
curl -k -I --resolve my-app.${BASE_DOMAIN}:443:127.0.0.1 https://my-app.${BASE_DOMAIN}
curl -I https://my-app.${BASE_DOMAIN}
```

Do not stop at `docker compose up -d`. A deployment is incomplete until all checks pass.

## Frontend Env Guardrail (Next.js)

For Next.js apps, values prefixed with `NEXT_PUBLIC_` are compiled into the client bundle at build time.

If you change a public URL such as websocket endpoint (`NEXT_PUBLIC_WS_URL`), you must rebuild the frontend image:

```bash
docker compose --env-file .env.production up -d --build frontend
```

Recreating a container without rebuilding will keep old client-side values.

For HTTPS sites, websocket endpoints must use `wss://` (not `ws://`) to avoid mixed-content failures.

## Common Failure Modes

- Container stays in `Created` and never starts
- App is not attached to `ez_testbench_proxy`
- Route exists only for HTTP and not HTTPS
- Static route points to a stale container name
- Public hostname is tested, but origin host-header checks were skipped
- Core Traefik health check is red because `/ping` was enabled in the health check but not in Traefik itself
- Frontend still serves old `NEXT_PUBLIC_*` values because the container was recreated without `--build`
- HTTPS page tries to connect to `ws://...` and fails in browser with mixed-content errors

## Optional Dashboard Integration

If the app should appear on the bench dashboard, add it to `dashboard/homepage/services.yaml` only after the public URL is confirmed working.

## Definition Of Done

Only mark the deployment done when all of the following are true:

- the app container is running
- health checks pass when defined
- Traefik reaches the app on HTTP and HTTPS from the origin host
- the public hostname responds successfully
- any dashboard entry points to the final URL
