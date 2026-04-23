# EZ Testbench

A Docker-first Ubuntu Server test bench for staging, monitoring, and operating multiple applications from a single host.

## What this gives you

- A shared reverse-proxy layer with Traefik for routing containerized apps.
- Metrics collection with Prometheus, cAdvisor, and Node Exporter.
- Visualization with Grafana.
- Container operations through Portainer.
- Uptime checks through Uptime Kuma.
- A simple landing dashboard through Homepage.
- An app template and example service so you can onboard new containers quickly.

## Stack layout

| Service | Purpose | Default URL |
| --- | --- | --- |
| Homepage | Human-friendly landing page | http://SERVER_IP:3000 |
| Grafana | Metrics dashboards | http://SERVER_IP:3001 |
| Prometheus | Metrics and scrape targets | http://SERVER_IP:9090 |
| Portainer | Docker management UI | https://SERVER_IP:9443 |
| Uptime Kuma | Availability monitoring | http://SERVER_IP:3002 |
| Traefik | Reverse proxy and routing dashboard | http://SERVER_IP:8081 |

Apps intended for the bench should join the `ez_testbench_proxy` Docker network. If they expose Prometheus metrics, they can also join `ez_testbench_monitoring`.

## Quick start on Ubuntu Server

1. Clone this repository to the server.
2. Install Docker:

```bash
sudo bash scripts/bootstrap-ubuntu.sh
```

3. Create your environment file:

```bash
cp .env.example .env
```

4. Review `.env` and change at least:
   - `TIMEZONE`
   - `BASE_DOMAIN`
   - `GRAFANA_ADMIN_PASSWORD`

5. Start the core bench:

```bash
docker compose up -d
```

6. Start the example application:

```bash
docker compose -f apps/whoami/compose.yml up -d
```

7. Open the dashboards using your server IP and ports from the table above.

## Recommended first-run tasks

- In Portainer, connect the local Docker environment if it is not auto-detected.
- In Uptime Kuma, add HTTP checks for each app and dashboard you care about.
- In Grafana, import community dashboards such as:
  - Node Exporter Full (`1860`)
  - Docker and system monitoring via cAdvisor (`14282` or another current cAdvisor dashboard)
  - Traefik dashboards from Grafana Labs
- Add DNS records or local host entries for routes like `whoami.${BASE_DOMAIN}` if you want host-based routing through Traefik.

## Adding your applications

Use `apps/_template/compose.yml` as the baseline for any service you want to expose through the bench.

Minimum pattern:

- Join `ez_testbench_proxy` so Traefik can route to the app.
- Add Traefik labels for the hostname and internal service port.
- Join `ez_testbench_monitoring` if the container exports Prometheus metrics.
- Add an Uptime Kuma check for the external route.
- Add a tile in `dashboard/homepage/services.yaml` if you want it visible on the landing page.
- **Set resource limits** (`deploy.resources.limits`) to prevent starving core services.
- **Pin image tags** (never use `latest`).

## Deployment Guidelines for AI Workers

This section ensures that automated deployments integrate safely with the core infrastructure without disrupting existing services. **All deployments must follow these rules.**

### Before Deploying

1. **Always use the template**: Start from `apps/_template/compose.yml`—never modify the core `compose.yml` or infrastructure services
2. **Review the deployment rules** below before submitting any deployment
3. **Test in a staging environment** first (see validation commands below)
4. **Get approval** before deploying to production if this is a shared system

### Required Deployment Rules

Your deployment **must** meet all these requirements or it will fail and be rolled back:

| Requirement | Why | Valid Example | Invalid Example |
|---|---|---|---|
| Use external networks only | Core infrastructure cannot be recreated | `networks: { proxy: { external: true, name: ez_testbench_proxy } }` | `networks: { proxy: {} }` (creates new network) |
| Set resource limits | Prevents resource starvation | `deploy: { resources: { limits: { cpus: '1', memory: 512M } } }` | No `deploy` section (unlimited resources) |
| Pin image version | Reproducible, predictable deployments | `image: myapp:1.2.3` | `image: myapp:latest` |
| No privileged mode | Security isolation | ✅ Default (unprivileged) | ❌ `privileged: true` |
| No direct port bindings | Use Traefik routing for external access | `labels: [traefik.enable=true]` | `ports: [8080:8080]` |
| Unique hostname pattern | Prevents routing conflicts | `traefik.http.routers.myapp.rule=Host('myapp.${BASE_DOMAIN}')` | Same hostname as another app |
| Join monitoring network | Enables metrics collection | `networks: [proxy, monitoring]` | `networks: [proxy]` (if metrics exist) |
| Restart policy | Prevents cascading failures | `restart: unless-stopped` | `restart: always` |
| No host volume mounts | Protects system files | `volumes: [app-data:/app/data]` (named volume) | `volumes: [/etc:/etc]` |
| No Docker socket access | Security boundary protection | Don't mount `/var/run/docker.sock` | ❌ `volumes: [/var/run/docker.sock:/var/run/docker.sock]` |
| No Cap Add or Devices | Security isolation | ✅ Default (no extra caps) | ❌ `cap_add: [NET_ADMIN]` or `devices: [...]` |

### Pre-Deployment Validation

Before running `docker compose up -d`, run **all** of these checks:

```bash
# 1. Validate compose syntax
docker compose -f apps/YOUR_APP/compose.yml config

# 2. Dry-run simulation (check for errors without starting)
docker compose -f apps/YOUR_APP/compose.yml up --dry-run

# 3. Check external networks exist
docker network ls | grep ez_testbench_proxy
docker network ls | grep ez_testbench_monitoring

# 4. Verify no port conflicts with core services
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "80|443|8081|9000|9090|3000|3001|3002"
```

**Pre-deployment checklist** (mark each ✓):
- [ ] `docker compose config` runs without errors
- [ ] `docker compose up --dry-run` shows no errors
- [ ] External networks `ez_testbench_proxy` and `ez_testbench_monitoring` exist
- [ ] No `networks:` section creates new networks (only references external ones)
- [ ] Service has `deploy.resources.limits` with both `cpus` and `memory` set
- [ ] Service uses `restart: unless-stopped` (not `always`)
- [ ] No `privileged: true`, `cap_add`, or `devices` entries
- [ ] No direct `ports:` bindings for external access (use Traefik labels instead)
- [ ] Traefik hostname is unique and uses `${BASE_DOMAIN}` format
- [ ] All volumes are named volumes (not host mounts to `/etc`, `/root`, `/var/log`, etc.)
- [ ] Image version is pinned (not `latest`)
- [ ] Container name follows pattern `ez-testbench-app-name` (no conflicts)

### How to Deploy Safely

**Step 1: Create your app directory**
```bash
mkdir -p apps/my-app
cp apps/_template/compose.yml apps/my-app/compose.yml
```

**Step 2: Edit the compose file**
- Replace `app-name` with your app's name (3-16 chars, lowercase, no spaces)
- Replace `your-image:1.0.0` with your actual image and pinned tag
- Adjust resource limits (`cpus` and `memory`) based on your app's needs
- Update the Traefik hostname rule to match your app name
- Add your app-specific environment variables and volumes

**Step 3: Validate locally**
```bash
# Check syntax
docker compose -f apps/my-app/compose.yml config

# Dry-run (no containers created)
docker compose -f apps/my-app/compose.yml up --dry-run
```

**Step 4: Deploy to production**
```bash
# Pull latest image
docker compose -f apps/my-app/compose.yml pull

# Start the service
docker compose -f apps/my-app/compose.yml up -d

# Monitor logs
docker compose -f apps/my-app/compose.yml logs -f
```

**Step 5: Verify integration** (run all checks)
```bash
# Container is running
docker ps | grep my-app

# No errors in logs
docker compose -f apps/my-app/compose.yml logs --tail=20

# Core services still healthy
docker ps --format "table {{.Names}}\t{{.Status}}"

# Traefik sees your service
curl -s http://SERVER_IP:8081/api/services | grep my-app

# App is reachable via Traefik
curl http://my-app.${BASE_DOMAIN}
```

### If Something Goes Wrong

**Quick rollback** (immediately stops the deployed app):
```bash
docker compose -f apps/my-app/compose.yml down
```

**Diagnose common issues**:
```bash
# Check logs for errors
docker compose -f apps/my-app/compose.yml logs --tail=50

# Check if core services are healthy
docker inspect --format='{{.State.Health.Status}}' ez-testbench-traefik
docker inspect --format='{{.State.Health.Status}}' ez-testbench-prometheus

# Check resource usage (if app is consuming too much)
docker stats --no-stream | grep my-app

# Check port conflicts
netstat -tuln | grep -E "80|443|8081|9000|9090|3000|3001|3002"

# Restart core infrastructure
docker compose restart traefik prometheus grafana
```

**Restore core services** (if infrastructure is broken):
```bash
docker compose down
docker compose up -d
# Wait 30 seconds for services to start
sleep 30
docker ps  # Verify all core services are running
```

### What Breaks the System (DO NOT DO)

❌ **Modifying or recreating the `ez_testbench_proxy` or `ez_testbench_monitoring` networks**  
❌ **Running services with `privileged: true` or `cap_add`**  
❌ **Binding directly to ports 80, 443, 8081, 9000, 9090, 3000, 3001, 3002** (reserved for core services)  
❌ **Mounting `/var/run/docker.sock` without explicit approval**  
❌ **Creating named volumes that conflict with existing ones** (`prometheus-data`, `grafana-data`, `portainer-data`, `kuma-data`)  
❌ **Not setting resource limits** (will starve Traefik, Prometheus, or Grafana)  
❌ **Using `image: latest` or untagged images** (unpredictable version changes)  
❌ **Modifying core infrastructure files** (`compose.yml`, `monitoring/`, `dashboard/`, `scripts/`)  
❌ **Using `restart: always`** (can cause cascading restarts during outages)  
❌ **Mounting host directories** like `/etc`, `/root`, `/var`, `/var/lib`, `/tmp` (security risk)

### Quick Reference: Deployment Checklist

Copy and paste this before each deployment:

```
BEFORE DEPLOY:
✓ docker compose -f apps/YOUR_APP/compose.yml config
✓ docker compose -f apps/YOUR_APP/compose.yml up --dry-run
✓ docker network ls | grep ez_testbench
✓ Traefik labels use ${BASE_DOMAIN}
✓ Image version pinned (not latest)
✓ Resource limits set (cpus + memory)
✓ No privileged, cap_add, devices, or /var/run/docker.sock
✓ External networks only
✓ Restart policy is unless-stopped
✓ No direct port bindings

AFTER DEPLOY:
✓ docker ps | grep YOUR_APP
✓ docker compose -f apps/YOUR_APP/compose.yml logs | grep -i error
✓ curl http://YOUR_APP.${BASE_DOMAIN}
✓ docker ps --format "table {{.Names}}\t{{.Status}}" (core services all Up)
```

### For AI Worker Assignments

If you are an AI worker being assigned to deploy on this system:

1. **Read this entire section first**
2. **Download [DEPLOYMENT_GUIDELINES.md](DEPLOYMENT_GUIDELINES.md) and [DEPLOYMENT_SKILL.md](DEPLOYMENT_SKILL.md)** for detailed instructions
3. **Follow the pre-deployment checklist** before any deployment
4. **Test in staging first** (use dry-run)
5. **Run all verification checks** after deployment
6. **Report any failures or breakages immediately**

If a deployment breaks the core infrastructure:
- Run `docker compose down && docker compose up -d` to recover
- Report what went wrong with full logs
- Do not attempt further deployments until the issue is understood

## Suggested production-minded additions

This repository starts simple so it is easy to run on a single server. For a more hardened setup, consider:

- Replacing plain HTTP routes with TLS certificates through Traefik ACME.
- Putting the admin UIs behind authentication middleware or a VPN.
- Adding Loki plus Promtail for centralized logs.
- Adding Alertmanager for notifications.
- Backing up Grafana, Portainer, and Uptime Kuma volumes.

## Notes

- Traefik is configured with `api.insecure=true` for fast lab setup. Do not keep that setting exposed on the public internet.
- The example app route uses `${BASE_DOMAIN}` from `.env`. If you do not have internal DNS, use the direct mapped ports first.
