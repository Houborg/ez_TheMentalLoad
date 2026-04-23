# EZ Testbench Deployment Guidelines

**For: AI workers and automated deployment systems**  
**Last Updated: 2026-04-22**  
**Version: 1.0**

This document provides detailed, step-by-step instructions for safely deploying applications to the ez_testbench system. It ensures that new deployments do not break core infrastructure.

---

## Quick Start (TL;DR)

```bash
# 1. Create app from template
mkdir -p apps/my-app
cp apps/_template/compose.yml apps/my-app/compose.yml

# 2. Edit: app name, image version, resource limits, Traefik hostname
# 3. Validate
docker compose -f apps/my-app/compose.yml config
docker compose -f apps/my-app/compose.yml up --dry-run

# 4. Deploy
docker compose -f apps/my-app/compose.yml up -d

# 5. Verify
docker ps | grep my-app
curl http://my-app.${BASE_DOMAIN}
```

---

## System Architecture Overview

### Core Infrastructure (Protected)

These services **cannot be modified or recreated**:

| Service | Port | Purpose | Network |
|---------|------|---------|---------|
| Traefik | 80, 443, 8081 | Reverse proxy & routing | `ez_testbench_proxy`, `ez_testbench_monitoring` |
| Prometheus | 9090 | Metrics storage | `ez_testbench_monitoring` |
| Grafana | 3001 | Metrics visualization | `ez_testbench_monitoring` |
| Portainer | 9000, 9443 | Docker management | `ez_testbench_proxy`, `ez_testbench_monitoring` |
| Uptime Kuma | 3002 | Availability monitoring | `ez_testbench_proxy`, `ez_testbench_monitoring` |
| Homepage | 3000 | Landing page | `ez_testbench_proxy`, `ez_testbench_monitoring` |
| cAdvisor | (internal) | Container metrics | `ez_testbench_monitoring` |
| Node Exporter | (internal) | Host metrics | `ez_testbench_monitoring` |

### External Networks (Shared)

Apps **must** join these existing networks:

- **`ez_testbench_proxy`**: External routing through Traefik
- **`ez_testbench_monitoring`**: Metrics collection (if app exports Prometheus metrics)

These networks **already exist** and **must not be recreated**.

### App Deployment Area

Apps are deployed in `apps/` subdirectories:

```
apps/
├── _template/           ← Use this as a base
│   └── compose.yml
├── whoami/              ← Example app
│   └── compose.yml
└── my-app/              ← Your new app (create here)
    └── compose.yml
```

---

## Step-by-Step Deployment

### Step 1: Prepare Your App Directory

```bash
# Create a new directory for your app
mkdir -p apps/my-app

# Copy the template
cp apps/_template/compose.yml apps/my-app/compose.yml

# Edit the file
nano apps/my-app/compose.yml  # or use your editor
```

### Step 2: Configure Your Compose File

Edit `apps/my-app/compose.yml` and replace:

| Field | Original | Your Value | Notes |
|-------|----------|-----------|-------|
| `container_name` | `ez-testbench-app-name` | `ez-testbench-my-app` | Keep `ez-testbench-` prefix, no spaces |
| `image` | `your-image:1.0.0` | `registry/image:x.y.z` | **Always pin version, never `latest`** |
| `traefik.http.routers.app-name.rule` | `Host('app-name.${BASE_DOMAIN}')` | `Host('my-app.${BASE_DOMAIN}')` | Must be unique |
| `cpus` (in limits) | `1` | Based on app needs | Test and adjust |
| `memory` (in limits) | `512M` | Based on app needs | Test and adjust |

**Example edited section:**

```yaml
services:
  my-app:
    image: nginx:1.25.4  # Pinned version ✓
    container_name: ez-testbench-my-app
    restart: unless-stopped
    # ... (keep the rest the same)
    labels:
      - traefik.enable=true
      - traefik.http.routers.my-app.rule=Host(`my-app.${BASE_DOMAIN}`)  # Unique ✓
      - traefik.http.routers.my-app.entrypoints=web
      - traefik.http.services.my-app.loadbalancer.server.port=80
    # ... (keep networks, deploy.resources, healthcheck, etc.)
    deploy:
      resources:
        limits:
          cpus: '0.5'      # Adjusted for lightweight app ✓
          memory: 128M
```

### Step 3: Validate Your Configuration

**Never skip this step.** Run all validation commands:

```bash
# 1. Syntax validation (must have zero errors)
docker compose -f apps/my-app/compose.yml config
# Output should show the full compose configuration with no errors

# 2. Dry-run (simulates deployment without creating containers)
docker compose -f apps/my-app/compose.yml up --dry-run
# Output should show what would be created with no errors

# 3. Verify external networks exist
docker network ls | grep ez_testbench_proxy
# Output: Should show "ez_testbench_proxy" network

docker network ls | grep ez_testbench_monitoring
# Output: Should show "ez_testbench_monitoring" network

# 4. Check for reserved port conflicts
docker ps --format "table {{.Names}}\t{{.Ports}}"
# Output: Scan for ports 80, 443, 8081, 9000, 9090, 3000, 3001, 3002
#         These should only be used by core services
```

**If any validation fails:**
- Fix the issue in `compose.yml`
- Run validation again
- Do NOT proceed to Step 4 until all validations pass

### Step 4: Pull the Image

Before deploying, ensure the image is available locally:

```bash
docker compose -f apps/my-app/compose.yml pull
# Output: Should show image download progress
# Do NOT use --pull=always in the deploy command
```

If pull fails:
- Check image name and tag are correct
- Verify image exists in the registry
- Check credentials if private registry
- Fix and retry

### Step 5: Deploy to Production

```bash
docker compose -f apps/my-app/compose.yml up -d
# Output: Should show container creation confirmation
```

Monitor the startup:

```bash
# Watch logs in real-time (Ctrl+C to exit)
docker compose -f apps/my-app/compose.yml logs -f

# Or check status
docker ps | grep my-app
```

Expected log output:
- No `ERROR` messages
- Service should show as "Up" within 30 seconds
- Healthcheck should pass

### Step 6: Verify Complete Integration

Run **all** verification checks:

```bash
# 1. Container is running and healthy
docker ps | grep my-app
# Output: Should show "my-app" container with status "Up X seconds"

docker inspect --format='{{.State.Health.Status}}' ez-testbench-my-app
# Output: "healthy" (after 15-30 seconds)

# 2. No errors in logs
docker compose -f apps/my-app/compose.yml logs --tail=20
# Output: Should show startup messages, no ERROR lines

# 3. Core services still healthy
docker ps --format "table {{.Names}}\t{{.Status}}"
# Output: All core services (traefik, prometheus, grafana, etc.) should be "Up"

docker inspect --format='{{.State.Health.Status}}' ez-testbench-traefik
docker inspect --format='{{.State.Health.Status}}' ez-testbench-prometheus
# Output: Both should be "healthy"

# 4. Traefik recognizes the app
curl -s http://SERVER_IP:8081/api/services | jq '.[] | select(.name | contains("my-app"))'
# Output: Should show your app's service configuration

# 5. App is accessible through Traefik
curl -I http://my-app.${BASE_DOMAIN}
# Output: Should return HTTP 200 or 3xx (not 502 Bad Gateway)

# 6. Prometheus is scraping metrics (if applicable)
curl -s http://SERVER_IP:9090/api/v1/targets | jq '.data.activeTargets[] | select(.labels.job=="my-app")' 2>/dev/null || echo "No metrics yet (normal for non-metric apps)"
```

**All checks must pass. If any fail:**

1. Check logs: `docker compose -f apps/my-app/compose.yml logs`
2. See [Troubleshooting](#troubleshooting) section
3. Roll back: `docker compose -f apps/my-app/compose.yml down`

---

## Resource Limits Reference

Choose resource limits based on your app's typical usage:

| App Type | CPU Limit | Memory Limit | Use Case |
|----------|-----------|--------------|----------|
| Web API (lightweight) | 0.25 | 128M | Simple REST API, static files |
| Web App (standard) | 0.5 | 256M | Node.js, Python Flask, typical services |
| Web App (heavy) | 1.0 | 512M | Java, .NET, complex processing |
| Database | 2.0 | 1024M | MySQL, PostgreSQL, data processing |
| ML/GPU workload | Contact Admin | Contact Admin | Requires special setup |

**Recommendations:**

1. Start with the conservative estimate for your app type
2. Monitor resource usage: `docker stats --no-stream | grep my-app`
3. If container is throttled (CPU at limit), increase by 0.25 CPU
4. If app crashes (OOMKilled), increase memory by 128M
5. Never set limits higher than the host has available

---

## Common Configuration Patterns

### Simple HTTP Service

```yaml
services:
  my-app:
    image: myimage:1.0.0
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.my-app.rule=Host(`my-app.${BASE_DOMAIN}`)
      - traefik.http.routers.my-app.entrypoints=web
      - traefik.http.services.my-app.loadbalancer.server.port=8080
    networks:
      - proxy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
```

### Service with Metrics

```yaml
services:
  my-app:
    # ... (as above)
    networks:
      - proxy
      - monitoring  # Added ✓
    # ... (rest of config)
```

### Service with Database Volume

```yaml
services:
  my-app:
    # ... (as above)
    volumes:
      - my-app-data:/app/data  # Named volume ✓ (not /var/lib or /etc)
    # ... (rest of config)

volumes:
  my-app-data:  # Define at bottom of file
```

### Service with Environment Variables

```yaml
services:
  my-app:
    image: myimage:1.0.0
    environment:
      APP_ENV: production
      LOG_LEVEL: info
      DATABASE_URL: postgres://db:5432/app  # Use internal container names
    # ... (rest of config)
```

---

## Troubleshooting

### Problem: `docker compose config` fails

**Error:** `yaml.scanner.ScannerError` or `compose file is invalid`

**Solution:**
1. Check YAML indentation (must be 2 spaces, not tabs)
2. Check quotes around strings with special characters
3. Verify all brackets `{}` and lists `[]` are properly closed
4. Try: `docker compose -f apps/my-app/compose.yml config --no-interpolate` (shows raw file)

### Problem: `docker compose up --dry-run` fails

**Error:** `Network (xyz) not found` or `invalid reference`

**Solution:**
1. Verify external networks exist: `docker network ls | grep ez_testbench`
2. If missing, recreate: `docker network create ez_testbench_proxy`
3. Verify image can be pulled: `docker pull your-image:tag`

### Problem: Container exits immediately

**Error:** Container status shows `Exited (1)` after seconds

**Solution:**
1. Check logs: `docker compose -f apps/my-app/compose.yml logs`
2. Look for startup errors (missing env vars, config files, ports)
3. Verify image is correct
4. Test image locally: `docker run -it your-image:tag /bin/bash`

### Problem: Port conflict (Address already in use)

**Error:** `bind: address already in use` or container won't start

**Solution:**
1. Check which service is using the port: `lsof -i :PORT` (Linux) or `netstat -tuln | grep PORT` (all platforms)
2. If a core service is using it, your app must use Traefik (not direct ports)
3. If your app has no external port binding, ignore this error

### Problem: Traefik shows "Bad Gateway" (502)

**Error:** Accessing `http://my-app.${BASE_DOMAIN}` returns `Bad Gateway`

**Solution:**
1. Verify app is running: `docker ps | grep my-app`
2. Verify app is healthy: `docker exec ez-testbench-my-app curl http://localhost:8080` (replace port)
3. Check Traefik logs: `docker compose logs traefik | tail -20`
4. Verify Traefik port label matches app's listening port
5. Restart app: `docker compose -f apps/my-app/compose.yml restart`

### Problem: Prometheus metrics not showing

**Error:** App is running but metrics not in Prometheus

**Solution:**
1. Verify app exports metrics: `curl http://localhost:8080/metrics` (from inside container)
2. Verify app is on `monitoring` network: `docker network inspect ez_testbench_monitoring | grep my-app`
3. Check Prometheus scrape config: `cat monitoring/prometheus/prometheus.yml | grep -A 5 my-app`
4. Wait 60 seconds, Prometheus scrapes every 15s, needs time to collect

### Problem: Resource limits too low (container killed)

**Error:** Container status `Exited (137)` or `OOMKilled` in logs

**Solution:**
1. Check actual resource usage before crash: `docker stats --no-stream` (from earlier runs)
2. Increase limits: Increase `cpus` by 0.25 or `memory` by 128M
3. Redeploy: `docker compose -f apps/my-app/compose.yml down && docker compose -f apps/my-app/compose.yml up -d`

### Problem: Core service crashed (traefik, prometheus, etc.)

**Error:** Core service status is `Exited` or `unhealthy`

**Solution (immediate):**
```bash
# Restart core services
docker compose restart traefik prometheus grafana

# If that doesn't work, full recovery
docker compose down
docker compose up -d

# Wait 30 seconds for startup
sleep 30

# Verify
docker ps  # All should be "Up"
```

**Cause investigation:**
1. Check logs: `docker compose logs traefik | tail -50`
2. Check resource usage: `docker stats --no-stream`
3. Review recent app deployments (may have consumed resources)
4. Look for port conflicts

---

## Quick Commands Reference

```bash
# List all running apps
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

# Stop an app
docker compose -f apps/my-app/compose.yml down

# Restart an app
docker compose -f apps/my-app/compose.yml restart

# View real-time logs
docker compose -f apps/my-app/compose.yml logs -f

# View last 100 lines
docker compose -f apps/my-app/compose.yml logs --tail=100

# Execute command in container
docker exec ez-testbench-my-app /bin/bash
docker exec ez-testbench-my-app curl http://localhost:8080/health

# Check resource usage
docker stats --no-stream | grep my-app

# Inspect container details
docker inspect ez-testbench-my-app | jq '.State.Health.Status'

# Update and redeploy
docker compose -f apps/my-app/compose.yml pull
docker compose -f apps/my-app/compose.yml up -d

# Full cleanup (removes container, volumes remain)
docker compose -f apps/my-app/compose.yml down

# Full cleanup with volumes (removes everything)
docker compose -f apps/my-app/compose.yml down -v
```

---

## Rollback Procedure

If deployment causes issues:

**Immediate rollback (stop the app):**
```bash
docker compose -f apps/my-app/compose.yml down
```

**Verify core services recovered:**
```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
# All core services should be "Up"
```

**If core services are down, full recovery:**
```bash
docker compose down
docker compose up -d
sleep 30
docker ps
```

**Report the issue:**
- What went wrong?
- Full logs from deployment
- Resource usage at time of failure
- What compose file was used

---

## Next Steps

1. ✓ Read this entire document
2. ✓ Prepare your compose file from the template
3. ✓ Run all validation checks
4. ✓ Deploy and verify
5. Share feedback or report issues

**For AI workers:** After successful deployment, update the Homepage dashboard to include your app:
- Edit `dashboard/homepage/services.yaml`
- Add a tile entry for your service

---

## References

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Traefik Router Configuration](https://docs.traefik.io/routing/routers/)
- [Prometheus Scrape Config](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#scrape_config)
- [Docker Resource Limits](https://docs.docker.com/config/containers/resource_constraints/)
- EZ Testbench README: `README.md`
