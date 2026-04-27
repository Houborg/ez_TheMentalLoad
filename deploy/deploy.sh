#!/usr/bin/env bash
# ============================================================
# ez_TheMentalLoad — Production Deployment Script
# Follows: Deployment_rules/DEPLOYMENT_SKILL.md
# ============================================================
# Usage (from repo root on the server):
#   ./deploy/deploy.sh
#
# First-time setup:
#   cp deploy/.env.production.example deploy/.env.production
#   nano deploy/.env.production   # fill in all CHANGE_ME values
#   ./deploy/deploy.sh
# ============================================================

set -euo pipefail

COMPOSE="docker compose -f deploy/compose.prod.yml --env-file deploy/.env.production"
APP_NAME="mentalload"
CONTAINERS=(
  ez-mentalload-postgres
  ez-mentalload-redis
  ez-mentalload-ollama
  ez-mentalload-backend
  ez-mentalload-worker
  ez-mentalload-frontend
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }

# ── Guard: must run from repo root ────────────────────────────
if [[ ! -f "deploy/compose.prod.yml" ]]; then
  fail "Run this script from the repository root, e.g.: ./deploy/deploy.sh"
  exit 1
fi

# ── Guard: env file must exist ────────────────────────────────
if [[ ! -f "deploy/.env.production" ]]; then
  fail "deploy/.env.production not found."
  echo "   Run: cp deploy/.env.production.example deploy/.env.production"
  echo "   Then edit it and fill in all CHANGE_ME values."
  exit 1
fi

if grep -q "CHANGE_ME" deploy/.env.production; then
  fail "deploy/.env.production still contains CHANGE_ME placeholders. Fill them in first."
  exit 1
fi

echo ""
echo "============================================================"
echo " ez_TheMentalLoad — Deploying to ez_testbench"
echo "============================================================"
echo ""

# ── Step 1: Pre-flight checks ─────────────────────────────────
echo "[ Step 1 ] Pre-flight checks..."

if docker network ls | grep -q "ez_testbench_proxy"; then
  ok "ez_testbench_proxy network exists"
else
  fail "ez_testbench_proxy network NOT found."
  echo "   Is ez_testbench running? Run: docker compose up -d (in the ez_testbench directory)"
  exit 1
fi

if docker network ls | grep -q "ez_testbench_monitoring"; then
  ok "ez_testbench_monitoring network exists"
else
  warn "ez_testbench_monitoring not found (optional — metrics won't be collected)"
fi

# ── Step 2: Pull latest code ──────────────────────────────────
echo ""
echo "[ Step 2 ] Pulling latest code..."
git pull
ok "git pull complete"

# ── Step 3: Validate compose syntax ──────────────────────────
echo ""
echo "[ Step 3 ] Validating compose configuration..."
if $COMPOSE config > /dev/null 2>&1; then
  ok "Compose configuration valid"
else
  fail "Compose configuration invalid:"
  $COMPOSE config
  exit 1
fi

# Dry-run (may not be supported on all Docker versions; skip on failure)
if $COMPOSE up --dry-run > /dev/null 2>&1; then
  ok "Compose dry-run passed"
else
  warn "Compose dry-run not supported on this Docker version (skipping)"
fi

# ── Step 4: Build images ──────────────────────────────────────
echo ""
echo "[ Step 4 ] Building images (this may take a few minutes)..."
$COMPOSE build --pull
ok "Images built"

# ── Step 5: Deploy ────────────────────────────────────────────
echo ""
echo "[ Step 5 ] Starting containers..."
$COMPOSE up -d
ok "Containers started"

# ── Step 6: Post-deployment verification ─────────────────────
echo ""
echo "[ Step 6 ] Verifying deployment..."
sleep 10   # allow containers a moment to initialise

ALL_GOOD=true

for CONTAINER in "${CONTAINERS[@]}"; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")
  if [[ "$STATUS" == "running" ]]; then
    ok "$CONTAINER is running"
  else
    fail "$CONTAINER status: $STATUS"
    ALL_GOOD=false
  fi
done

# Check for startup errors in the logs
echo ""
echo "Scanning logs for errors..."
for CONTAINER in ez-mentalload-backend ez-mentalload-frontend; do
  ERRORS=$(docker logs "$CONTAINER" --tail=30 2>&1 | grep -i "error\|fatal\|exception" | grep -v "DeprecationWarning" || true)
  if [[ -n "$ERRORS" ]]; then
    warn "Possible errors in $CONTAINER logs:"
    echo "$ERRORS"
  else
    ok "$CONTAINER logs look clean"
  fi
done

# ── Step 7: Report ────────────────────────────────────────────
echo ""
echo "============================================================"
if [[ "$ALL_GOOD" == true ]]; then
  ok "Deployment successful!"
  echo ""
  echo "  App URL (once BASE_DOMAIN is set):  http://mentalload.\${BASE_DOMAIN}"
  echo "  Backend health:  http://mentalload.\${BASE_DOMAIN}/api/v1/health"
  echo ""
  echo "  Traefik dashboard: http://SERVER_IP:8081"
  echo "  Portainer:         https://SERVER_IP:9443"
else
  fail "One or more containers failed. Rolling back..."
  $COMPOSE down
  echo ""
  echo "  Rollback complete. Check the error messages above."
  echo "  Full logs: docker compose -f deploy/compose.prod.yml logs --tail=50"
  exit 1
fi
echo "============================================================"
