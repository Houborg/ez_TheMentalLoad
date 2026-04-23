# EZ Testbench Deployment Skill

**Purpose:** Enable AI workers to safely deploy applications to the ez_testbench system  
**Target Audience:** AI agents and automated deployment systems  
**Format:** Skill definition / Instruction prompt  
**Version:** 1.0  
**Last Updated:** 2026-04-22

---

## System Overview

### What is ez_testbench?

ez_testbench is a Docker-based infrastructure on a single Ubuntu server that provides:
- **Traefik**: Reverse proxy for routing apps via hostnames
- **Prometheus + Grafana**: Metrics collection and visualization
- **Portainer**: Docker management UI
- **Uptime Kuma**: Availability monitoring
- **Homepage**: Central landing page
- **cAdvisor & Node Exporter**: System and container metrics

### Key Constraint

**All deployments must protect core infrastructure.** New apps are deployed in `apps/` directories as separate Docker Compose projects. They access shared networks but do not modify core services.

---

## Deployment Workflow

When assigned to deploy an application to ez_testbench:

### 1. Pre-Deployment Analysis

Before writing or deploying any code:

1. **Read requirements**
   - What application/image are you deploying?
   - What resource requirements (CPU, memory, traffic)?
   - Does it export Prometheus metrics?
   - What hostname/routing does it need?

2. **Check system status**
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}"
   # All core services (traefik, prometheus, grafana, portainer, uptime-kuma, homepage) must be "Up"
   
   docker network ls | grep ez_testbench
   # Both ez_testbench_proxy and ez_testbench_monitoring must exist
   ```
   
   If core services are down or networks missing → **STOP** and report to system admin

3. **Review deployment rules**
   - Understand the [Required Deployment Rules](#required-deployment-rules)
   - Understand the [Do Not Do List](#do-not-do-list)

### 2. Compose File Generation

**Always start from the template:**
```bash
mkdir -p apps/YOUR_APP_NAME
cp apps/_template/compose.yml apps/YOUR_APP_NAME/compose.yml
```

**Edit the file with these rules:**

| Field | Rule | Example |
|-------|------|---------|
| `container_name` | `ez-testbench-{app}` (no spaces, lowercase) | `ez-testbench-myapp` |
| `image` | **Pin the version, never use `latest`** | `nginx:1.25.4` (not `nginx:latest`) |
| `labels` - Traefik hostname | `Host('{app}.${BASE_DOMAIN}')` (unique) | `Host('myapp.${BASE_DOMAIN}')` |
| `labels` - service port | Match container's listening port | `port=8080` if app listens on 8080 |
| `networks` | Only external: `proxy` and/or `monitoring` | Never create inline networks |
| `deploy.resources.limits.cpus` | Estimate based on app type (0.25-2.0) | `"0.5"` for typical web app |
| `deploy.resources.limits.memory` | Estimate based on app type (128M-1G) | `"256M"` for typical web app |
| `restart` | **Always `unless-stopped`** (not `always`) | `restart: unless-stopped` |
| `volumes` | Named volumes only, no host paths | `my-app-data:/data` (not `/etc:/etc`) |

**DO NOT include:**
- `privileged: true`
- `cap_add`, `devices`
- `/var/run/docker.sock` mounts
- Direct `ports:` bindings for external access
- Creating new networks (inline `networks: {}` without `external: true`)

### 3. Validation (REQUIRED - NEVER SKIP)

Run **all** validation commands and report results:

```bash
# 1. Syntax check
docker compose -f apps/YOUR_APP_NAME/compose.yml config
# MUST succeed with zero errors

# 2. Dry-run simulation
docker compose -f apps/YOUR_APP_NAME/compose.yml up --dry-run
# MUST succeed with zero errors

# 3. Network verification
docker network ls | grep ez_testbench_proxy
docker network ls | grep ez_testbench_monitoring
# BOTH networks MUST exist

# 4. Reserved port check
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "80|443|8081|9000|9090|3000|3001|3002"
# ONLY core services should use these ports

# 5. Core services health
docker inspect --format='{{.State.Health.Status}}' ez-testbench-traefik
docker inspect --format='{{.State.Health.Status}}' ez-testbench-prometheus
# BOTH should return "healthy"
```

**If ANY validation fails:**
- Report the exact error
- Do NOT proceed with deployment
- Fix the compose file
- Re-run validation

### 4. Image Pull

```bash
docker compose -f apps/YOUR_APP_NAME/compose.yml pull
# Must succeed without errors
# If fails: image doesn't exist, tag mismatch, or registry issue
```

### 5. Deployment

```bash
docker compose -f apps/YOUR_APP_NAME/compose.yml up -d
# Container should start immediately

# Monitor startup
docker compose -f apps/YOUR_APP_NAME/compose.yml logs -f
# Watch for errors in first 30 seconds
# Press Ctrl+C to exit
```

### 6. Post-Deployment Verification (REQUIRED - ALL CHECKS)

Run every verification check and confirm all pass:

```bash
# 1. App container running
docker ps | grep YOUR_APP_NAME
# MUST show status "Up X seconds"

# 2. App is healthy
docker inspect --format='{{.State.Health.Status}}' ez-testbench-YOUR_APP_NAME
# MUST return "healthy" (wait up to 30 seconds)

# 3. No errors in logs
docker compose -f apps/YOUR_APP_NAME/compose.yml logs --tail=20 | grep -i error
# MUST show no ERROR lines

# 4. Core services still running
docker ps --format "table {{.Names}}\t{{.Status}}" | grep "ez-testbench"
# ALL core services MUST show "Up"

# 5. Traefik recognizes the app
curl -s http://SERVER_IP:8081/api/services | grep YOUR_APP_NAME
# MUST find your service name

# 6. App is accessible
curl -I http://YOUR_APP_NAME.${BASE_DOMAIN}
# MUST return HTTP 200 or 3xx (NOT 502 Bad Gateway)

# 7. If metrics: Prometheus scraping
curl -s http://SERVER_IP:9090/api/v1/targets | grep YOUR_APP_NAME 2>/dev/null
# SHOULD show your target (if app exports metrics)
```

**If ANY verification fails:**
- Check logs: `docker compose -f apps/YOUR_APP_NAME/compose.yml logs --tail=50`
- Roll back: `docker compose -f apps/YOUR_APP_NAME/compose.yml down`
- Report error and do not retry

### 7. Report Results

Report deployment status including:
- ✓ or ✗ for each validation check
- ✓ or ✗ for each verification check
- If failed: full error logs and compose file content
- If successful: app URL and any special instructions

---

## Required Deployment Rules

**MUST follow ALL of these:**

| Rule | Rationale | Violation Impact |
|------|-----------|-----------------|
| Only use external networks (external: true) | Prevents network recreation | Core infrastructure breaks |
| Set `deploy.resources.limits` (cpus + memory) | Prevents resource starvation | Core services (Traefik, Prometheus) become unresponsive |
| Pin image version (not `latest`) | Ensures reproducible deployments | Unexpected version changes, app breaks |
| Use `restart: unless-stopped` | Prevents cascading restarts | Cascade failures during outages |
| No `privileged: true`, `cap_add`, `devices` | Maintains security boundary | Security vulnerabilities |
| No `/var/run/docker.sock` mount | Prevents container escape | Security vulnerability |
| Traefik hostname uses `${BASE_DOMAIN}` | Ensures routing consistency | Routing conflicts, inaccessible app |
| Named volumes only (not `/etc`, `/var/lib`, etc.) | Protects host system | Host system corruption |
| Container name follows `ez-testbench-{name}` | Avoids conflicts | Container name collision |

---

## Do Not Do List

**GUARANTEED TO BREAK THE SYSTEM:**

❌ Modify or recreate `ez_testbench_proxy` or `ez_testbench_monitoring` networks  
❌ Bind directly to ports 80, 443, 8081, 9000, 9090, 3000, 3001, 3002  
❌ Run with `privileged: true`, `cap_add`, or `devices`  
❌ Mount `/var/run/docker.sock` without explicit approval  
❌ Use volumes named `prometheus-data`, `grafana-data`, `portainer-data`, `kuma-data`  
❌ Deploy without resource limits  
❌ Use `image: latest` or untagged images  
❌ Modify core files: `compose.yml`, `monitoring/`, `dashboard/`, `scripts/`  
❌ Use `restart: always` (use `unless-stopped`)  
❌ Mount `/etc`, `/root`, `/var`, `/tmp` directories from host  

---

## Recovery Procedure

If deployment breaks something:

**Immediate action (stop the app):**
```bash
docker compose -f apps/YOUR_APP_NAME/compose.yml down
```

**Verify core services:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | head -15
# Traefik, Prometheus, Grafana should be "Up"
```

**If core services are down, full recovery:**
```bash
docker compose down
docker compose up -d
sleep 30
docker ps
# Wait until all core services show "Up"
```

**Report incident with:**
- What was deployed
- Exact error/symptom
- Full logs from deployment
- Resource usage graph (if available)
- Recovery steps taken

---

## Resource Estimation Table

When choosing resource limits, use this table as a starting point:

| Application Type | CPU Limit | Memory | Typical Services | Example |
|------------------|-----------|--------|------------------|---------|
| Simple REST API | 0.25 | 128M | FastAPI, Go microservice | `image: golang:alpine` |
| Node.js/Python web | 0.5 | 256M | Express, Flask, Django | `image: node:20-alpine` |
| Database | 1.0 | 512M | MySQL, PostgreSQL | `image: postgres:15` |
| Full-stack app | 1.0 | 512M | Next.js, SvelteKit | `image: node:20` |
| Resource-heavy | 2.0 | 1024M | ML models, video processing | Contact admin |

**Start conservative, monitor, adjust up if needed.**

---

## Troubleshooting Decision Tree

### "Docker compose config" fails
- [ ] Check YAML indentation (must be 2 spaces)
- [ ] Check all quotes, brackets, colons
- [ ] Run with `--no-interpolate` to see raw YAML

### "docker compose up --dry-run" fails
- [ ] Check networks exist: `docker network ls | grep ez_testbench`
- [ ] Check image exists: `docker pull image:tag`
- [ ] Check compose syntax again

### Container exits immediately
- [ ] Check logs: `docker compose logs`
- [ ] Look for: missing env vars, bad config, port conflicts
- [ ] Test image: `docker run -it image:tag /bin/bash`

### Port conflict or "Address already in use"
- [ ] Check what's using port: `netstat -tuln | grep PORT`
- [ ] If app shouldn't have direct port binding, remove `ports:` line
- [ ] Use Traefik routing instead (via labels)

### "Bad Gateway" (502 error)
- [ ] App running? `docker ps | grep app-name`
- [ ] App listening on right port? Check compose file `server.port`
- [ ] Check Traefik logs: `docker compose logs traefik | tail -20`

### Container "OOMKilled" (memory exceeded)
- [ ] Increase `memory` limit by 128M
- [ ] Redeploy: `down && up -d`

### Core service down/unhealthy
- [ ] **STOP** current deployment immediately
- [ ] Restart: `docker compose restart traefik prometheus grafana`
- [ ] If still down: `docker compose down && docker compose up -d`
- [ ] Wait 30 seconds and check: `docker ps`
- [ ] Report immediately with full logs

---

## Command Quick Reference

```bash
# Show all containers with status
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

# Check app logs
docker compose -f apps/MY_APP/compose.yml logs --tail=50

# Watch live logs
docker compose -f apps/MY_APP/compose.yml logs -f

# Stop app
docker compose -f apps/MY_APP/compose.yml down

# Restart app
docker compose -f apps/MY_APP/compose.yml restart

# Execute command in app
docker exec ez-testbench-my-app /bin/bash
docker exec ez-testbench-my-app curl http://localhost:8080/health

# Check resource usage (live)
docker stats

# Check specific container
docker stats ez-testbench-my-app --no-stream

# Inspect container details
docker inspect ez-testbench-my-app | jq '.State.Health'

# View network connections
docker network inspect ez_testbench_proxy

# Pull latest image
docker compose -f apps/MY_APP/compose.yml pull

# Redeploy
docker compose -f apps/MY_APP/compose.yml pull && docker compose -f apps/MY_APP/compose.yml up -d
```

---

## What Success Looks Like

✓ All validation checks pass  
✓ App container shows "Up" status  
✓ Health check shows "healthy"  
✓ Curl to app URL returns 200 (not 502)  
✓ Core services (traefik, prometheus, grafana) still healthy  
✓ Logs show no ERROR lines  
✓ Traefik dashboard shows app in services  
✓ Can reach app at `http://app-name.${BASE_DOMAIN}`  

---

## Decision: Proceed or Stop?

**PROCEED with deployment:**
- ✓ All validation checks pass
- ✓ Compose file follows all deployment rules
- ✓ Core services are healthy
- ✓ Image can be pulled successfully

**STOP and report:**
- ✗ Any validation check fails
- ✗ Compose file violates deployment rules
- ✗ Core services are unhealthy
- ✗ Image cannot be pulled
- ✗ System is already experiencing issues

---

## Additional Resources

- [Full Deployment Guidelines](DEPLOYMENT_GUIDELINES.md) - Detailed step-by-step walkthrough
- [README.md](README.md) - System overview and quick start
- [Template Compose File](apps/_template/compose.yml) - Commented template
- [Docker Compose Docs](https://docs.docker.com/compose/)
- [Traefik Router Reference](https://docs.traefik.io/routing/routers/)

---

## Summary

1. **Start from template:** `cp apps/_template/compose.yml apps/YOUR_APP/compose.yml`
2. **Edit**: app name, image (with version), resource limits, hostname
3. **Validate**: Run all 5 validation commands (don't skip!)
4. **Deploy**: `docker compose -f apps/YOUR_APP/compose.yml up -d`
5. **Verify**: Run all 7 verification checks (don't skip!)
6. **Report**: Success or failure with details

**Key principle:** Protect core infrastructure. Apps are sandboxed in `apps/` with resource limits, external networks only, no privileged access.
