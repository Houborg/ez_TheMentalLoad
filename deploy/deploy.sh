#!/usr/bin/env bash
# ============================================================
# ez_TheMentalLoad — Production Deployment Script
# Target: Testbench server (Cloudflare Tunnel, NOT Traefik)
# ============================================================
# Usage (run from the repo root on the server):
#   ./deploy/deploy.sh
#
# Or redeploy via the Testbench UI → Managed Apps → mentalload → Redeploy
# ============================================================

set -euo pipefail

COMPOSE="docker compose -f deploy/compose.prod.yml -p mentalload"
CONTAINERS=(
  mentalload-postgres
  mentalload-redis
  mentalload-ollama
  mentalload-backend
  mentalload-worker
  mentalload-frontend
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

echo ""
echo "============================================================"
echo " ez_TheMentalLoad — Deploying to Testbench"
echo "============================================================"
echo ""

# ── Step 1: Pre-flight checks ─────────────────────────────────
echo "[ Step 1 ] Pre-flight checks..."

if docker network ls | grep -q "testbench"; then
  ok "testbench network exists"
else
  fail "testbench network NOT found. Is the Testbench running?"
  exit 1
fi

# ── Step 2: Pull latest code ──────────────────────────────────
echo ""
echo "[ Step 2 ] Pulling latest code..."
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  if git rev-parse --verify HEAD > /dev/null 2>&1; then
    CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
    if [[ -n "$CURRENT_BRANCH" ]] && git rev-parse --abbrev-ref "${CURRENT_BRANCH}@{upstream}" > /dev/null 2>&1; then
      git pull --ff-only
      ok "git pull complete"
    else
      warn "No upstream tracking branch — skipping git pull."
    fi
  else
    warn "No commits yet — skipping git pull."
  fi
else
  warn "Not a git worktree — skipping git pull."
fi

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

# ── Step 4: Build images ──────────────────────────────────────
echo ""
echo "[ Step 4 ] Building images (this may take a few minutes)..."
$COMPOSE build --pull
ok "Images built"

# ── Step 5: Deploy ────────────────────────────────────────────
echo ""
echo "[ Step 5 ] Starting containers..."
$COMPOSE up -d --remove-orphans
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

echo ""
echo "Scanning logs for errors..."
for CONTAINER in mentalload-backend mentalload-frontend; do
  ERRORS=$(docker logs "$CONTAINER" --tail=30 2>&1 | grep -i "error\|fatal\|exception" | grep -v "DeprecationWarning" || true)
  if [[ -n "$ERRORS" ]]; then
    warn "Possible errors in $CONTAINER logs:"
    echo "$ERRORS"
  else
    ok "$CONTAINER logs look clean"
  fi
done

echo ""
echo "Checking public URL..."
if curl -sS -I "https://mentalload.pl0k.online" > /dev/null 2>&1; then
  ok "https://mentalload.pl0k.online is reachable"
else
  warn "https://mentalload.pl0k.online not reachable yet (tunnel may need a moment)"
fi

# ── Step 7: Report ────────────────────────────────────────────
echo ""
echo "============================================================"
if [[ "$ALL_GOOD" == true ]]; then
  ok "Deployment successful!"
  echo ""
  echo "  App URL : https://mentalload.pl0k.online"
  echo "  Health  : docker exec mentalload-backend wget -qO- http://127.0.0.1:3000/api/v1/health"
  echo ""
else
  fail "One or more containers failed. Rolling back..."
  $COMPOSE down
  echo ""
  echo "  Rollback complete. Check the error messages above."
  echo "  Full logs: docker compose -f deploy/compose.prod.yml -p mentalload logs --tail=50"
  exit 1
fi
echo "============================================================"
