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

BASE_DOMAIN_VALUE=$(grep -m1 '^BASE_DOMAIN=' deploy/.env.production | cut -d'=' -f2- | tr -d '"' | tr -d "'" | xargs)
APP_HOST="mentalload.${BASE_DOMAIN_VALUE}"

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
if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  if git rev-parse --verify HEAD > /dev/null 2>&1; then
    CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
    if [[ -n "$CURRENT_BRANCH" ]] && git rev-parse --abbrev-ref "${CURRENT_BRANCH}@{upstream}" > /dev/null 2>&1; then
      git pull --ff-only
      ok "git pull complete"
    else
      warn "No upstream tracking branch configured for '${CURRENT_BRANCH:-unknown}'. Skipping git pull."
    fi
  else
    warn "Git repository has no commits yet. Skipping git pull."
  fi
else
  warn "Not a git worktree. Skipping git pull."
fi

# ── Step 2.5: Bump version & capture build metadata ───────────
echo ""
echo "[ Step 2.5 ] Bumping version and capturing build metadata..."

# Increment the patch segment of the root package.json version when host npm is available.
# If npm/node are missing on the host, keep the current package version and continue.
HOST_CAN_BUMP=false
if command -v npm > /dev/null 2>&1 && command -v node > /dev/null 2>&1; then
  npm version patch --no-git-tag-version --workspaces-update=false > /dev/null
  HOST_CAN_BUMP=true
else
  warn "npm/node not available on host; using existing package.json version"
fi

if command -v node > /dev/null 2>&1; then
  BUILD_VERSION=$(node -p "require('./package.json').version")
else
  BUILD_VERSION=$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi
if git rev-parse --verify HEAD > /dev/null 2>&1; then
  BUILD_COMMIT=$(git rev-parse --short HEAD)
else
  BUILD_COMMIT="local"
fi
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
export BUILD_VERSION BUILD_COMMIT BUILD_TIME

# Persist build metadata into the production env file so compose interpolation
# and runtime container environment can use the same values.
sed -i '/^BUILD_VERSION=/d;/^BUILD_COMMIT=/d;/^BUILD_TIME=/d' deploy/.env.production
{
  echo "BUILD_VERSION=${BUILD_VERSION}"
  echo "BUILD_COMMIT=${BUILD_COMMIT}"
  echo "BUILD_TIME=${BUILD_TIME}"
} >> deploy/.env.production

ok "Version  : v${BUILD_VERSION}"
ok "Commit   : ${BUILD_COMMIT}"
ok "Timestamp: ${BUILD_TIME}"

# Commit the version bump so it's tracked in git history.
if [[ "$HOST_CAN_BUMP" == true ]] && git rev-parse --verify HEAD > /dev/null 2>&1 && ! git diff --quiet package.json; then
  git add package.json
  git commit -m "chore: bump version to ${BUILD_VERSION} [skip ci]"
  ok "Version bump committed"
elif [[ "$HOST_CAN_BUMP" == true ]] && git rev-parse --verify HEAD > /dev/null 2>&1; then
  warn "package.json unchanged — skipping version commit"
elif [[ "$HOST_CAN_BUMP" == true ]]; then
  warn "Skipping version commit (repository has no commits yet)"
else
  warn "Skipping version commit (version bump was not performed on host)"
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

# Dry-run (may not be supported on all Docker versions; skip on failure)
if $COMPOSE up --dry-run > /dev/null 2>&1; then
  ok "Compose dry-run passed"
else
  warn "Compose dry-run not supported on this Docker version (skipping)"
fi

# ── Step 4: Build images ──────────────────────────────────────
echo ""
echo "[ Step 4 ] Building images (this may take a few minutes)..."
$COMPOSE build --pull \
  --build-arg BUILD_VERSION="${BUILD_VERSION}" \
  --build-arg BUILD_COMMIT="${BUILD_COMMIT}" \
  --build-arg BUILD_TIME="${BUILD_TIME}"
ok "Images built (v${BUILD_VERSION} @ ${BUILD_COMMIT})"

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

echo ""
echo "Running origin and public routing checks..."
if [[ -n "$BASE_DOMAIN_VALUE" && "$BASE_DOMAIN_VALUE" != "CHANGE_ME" ]]; then
  if curl -sS -I -H "Host: ${APP_HOST}" http://127.0.0.1 > /dev/null; then
    ok "Origin HTTP host-header check passed for ${APP_HOST}"
  else
    fail "Origin HTTP host-header check failed for ${APP_HOST}"
    ALL_GOOD=false
  fi

  if curl -sS -k -I --resolve "${APP_HOST}:443:127.0.0.1" "https://${APP_HOST}" > /dev/null; then
    ok "Origin HTTPS resolve check passed for ${APP_HOST}"
  else
    fail "Origin HTTPS resolve check failed for ${APP_HOST}"
    ALL_GOOD=false
  fi

  if curl -sS -I "https://${APP_HOST}" > /dev/null; then
    ok "Public HTTPS check passed for ${APP_HOST}"
  else
    warn "Public HTTPS check failed for ${APP_HOST} (may be DNS/cert propagation)"
  fi
else
  warn "BASE_DOMAIN is empty or placeholder in deploy/.env.production; skipping host-based Traefik checks"
fi

# ── Step 7: Report ────────────────────────────────────────────
echo ""
echo "============================================================"
if [[ "$ALL_GOOD" == true ]]; then
  ok "Deployment successful!"

  # ── Version verification ────────────────────────────────────
  echo ""
  echo "Verifying deployed version..."
  HEALTH_JSON=$(curl -sf "http://127.0.0.1:3100/api/v1/health" 2>/dev/null || echo "{}")
  SERVER_VERSION=$(echo "$HEALTH_JSON" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true)
  SERVER_COMMIT=$(echo  "$HEALTH_JSON" | grep -o '"commit":"[^"]*"'  | cut -d'"' -f4 || true)

  if [[ "$SERVER_VERSION" == "$BUILD_VERSION" ]]; then
    ok "Version verified : v${SERVER_VERSION} (${SERVER_COMMIT:-unknown})"
  else
    warn "Version mismatch — server reported: '${SERVER_VERSION:-unknown}', expected: '${BUILD_VERSION}'"
    warn "The containers may still be initialising. Re-check manually:"
    warn "  curl http://127.0.0.1:3100/api/v1/health"
  fi

  echo ""
  echo "  App URL (once BASE_DOMAIN is set):  http://mentalload.\${BASE_DOMAIN}"
  echo "  Backend health:  http://mentalload.\${BASE_DOMAIN}/api/v1/health"
  echo ""
  echo "  Traefik dashboard: http://SERVER_IP:8081"
  echo "  Portainer:         https://SERVER_IP:9443"

  # ── Start / restart the update webhook ───────────────────────
  echo ""
  echo "Starting update-webhook.py on 127.0.0.1:9191..."
  pkill -f "update-webhook.py" 2>/dev/null || true
  sleep 1
  _WEBHOOK_SECRET=$(grep -m1 "^UPDATE_WEBHOOK_SECRET=" deploy/.env.production | cut -d'=' -f2 | tr -d "\"'" || true)
  if [[ -z "$_WEBHOOK_SECRET" || "$_WEBHOOK_SECRET" == "CHANGE_ME" ]]; then
    warn "UPDATE_WEBHOOK_SECRET not set — the 'Update production' UI button will not work."
    warn "Add it to deploy/.env.production, e.g.:"
    warn "  UPDATE_WEBHOOK_SECRET=\$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  else
    export UPDATE_WEBHOOK_SECRET="$_WEBHOOK_SECRET"
    nohup python3 deploy/update-webhook.py >> deploy/webhook.log 2>&1 &
    WEBHOOK_PID=$!
    sleep 1
    if curl -sf http://127.0.0.1:9191/health > /dev/null 2>&1; then
      ok "Update webhook running (PID ${WEBHOOK_PID})"
    else
      warn "Update webhook may not have started — check deploy/webhook.log"
    fi
  fi
else
  fail "One or more containers failed. Rolling back..."
  $COMPOSE down
  echo ""
  echo "  Rollback complete. Check the error messages above."
  echo "  Full logs: docker compose -f deploy/compose.prod.yml logs --tail=50"
  exit 1
fi
echo "============================================================"
