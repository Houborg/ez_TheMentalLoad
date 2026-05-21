# One-Button Update: Design Spec
_2026-05-21_

## Problem

MentalLoad was registered in the testbench without a git URL, so the webhook rebuilds from the local server path (`/home/mhouborg/ez_TheMentalLoad`) without pulling first. The stored compose also has absolute build contexts that the webhook container cannot reuse as a "source of truth" clone. The result: deploying updates requires SSH + manual webhook calls.

## Goal

A logged-in user presses **Update** in MentalLoad Developer Settings → the app fetches the latest commit from GitHub, rebuilds, and restarts. The PostgreSQL data volume is untouched.

---

## Architecture

```
User presses Update
  → MentalLoad frontend: POST /api/update
    → signs request with TESTBENCH_WEBHOOK_SECRET
    → posts { slug, gitUrl } to http://testbench-webhook:9001/app-deploy
      → webhook: git pull in source/ (or git clone on first run)
      → docker compose -f docker-compose.yml -p thementalload up -d --build --remove-orphans
        → containers restart with new code
        → thementalload_postgres_data volume untouched
```

---

## Changes

### 1. Testbench — `lib/compose.ts` (injectNetwork fix)

**File:** `TestBench/lib/compose.ts`

`injectNetwork` currently skips absolute build context paths (comment: "absolute paths are invalid in the webhook container"). With the source-dir model, absolute paths mean "repo root" and should be rewritten to `./source`.

**Change:** In the `hasGitUrl` block, remove the absolute-path guard. When context starts with `/`, rewrite to `./source`. Relative paths continue to work as before (`packages/backend` → `./source/packages/backend`).

```typescript
// Before
if (!origCtx.startsWith("./source") && !origCtx.startsWith("source") && !origCtx.startsWith("/")) {

// After
if (!origCtx.startsWith("./source") && !origCtx.startsWith("source")) {
  if (origCtx.startsWith("/")) {
    b.context = "./source";
  } else {
    const rel = origCtx.replace(/^\.\//, "").replace(/^\.$/, "");
    b.context = rel ? `./source/${rel}` : "./source";
  }
}
```

Same fix applies to the `typeof s.build === "string"` branch.

---

### 2. Testbench server-side — stored compose + DB

**Compose file:** `/repo/TestBench/data/apps/thementalload/docker-compose.yml` (inside testbench container)

Two updates, applied by running JS in the testbench container:

**a. Build contexts:** Change all `context: /home/mhouborg/ez_TheMentalLoad` to `context: ./source`. The `dockerfile:` paths stay unchanged (they are relative to context).

**b. Frontend env vars:** Add to the `frontend` service environment:
```yaml
TESTBENCH_WEBHOOK_URL: http://testbench-webhook:9001
TESTBENCH_WEBHOOK_SECRET: <same secret as in docker inspect testbench>
APP_SLUG: thementalload
APP_GIT_URL: https://github.com/Houborg/ez_TheMentalLoad.git
```

**DB update:** Update the `apps` table row for `thementalload` to set `git_url = 'https://github.com/Houborg/ez_TheMentalLoad.git'` so future compose regenerations call `injectNetwork(..., hasGitUrl=true)` and produce `./source` paths automatically.

---

### 3. MentalLoad — developer settings UI

**File:** `packages/frontend/components/mobile/mobile-settings-content.tsx` (Developer tab)

The `handleForceUpdate()` function already exists in `dashboard-app.tsx`. Verify the button is wired in the developer tab. If not, add:

```tsx
<button onClick={handleForceUpdate} disabled={updateStatus === 'updating'}>
  {updateStatus === 'updating' ? 'Updating…' : 'Update app'}
</button>
```

Show status feedback: idle → "Updating…" → "Update triggered — app will restart in ~3–5 min" → error if the webhook returns non-200.

---

### 4. Initial clone (one-time, on-server)

After the stored compose and DB are updated, trigger one deploy via the webhook (the same call as the Update button). Because `source/.git` does not exist yet, the webhook will `git clone` the repo. All subsequent presses do `git pull`.

The MentalLoad branch to clone: `feat/apple-calendar-sync` (current active branch on the server). Pass `gitUrl` only — no `gitToken` needed for a public repo.

> **Note:** Long-term, merge `feat/apple-calendar-sync` to `main` so the clone tracks the default branch.

---

## Data Safety

- `thementalload_postgres_data` is a named Docker volume. `docker compose up --build` never removes named volumes.
- `docker compose up --remove-orphans` removes containers not in the compose file but does not affect volumes.
- The DB is safe across every update.

---

## Env Vars Summary

| Service | Var | Value |
|---------|-----|-------|
| frontend | `TESTBENCH_WEBHOOK_URL` | `http://testbench-webhook:9001` |
| frontend | `TESTBENCH_WEBHOOK_SECRET` | (from `docker inspect testbench`) |
| frontend | `APP_SLUG` | `thementalload` |
| frontend | `APP_GIT_URL` | `https://github.com/Houborg/ez_TheMentalLoad.git` |

---

## Files Changed

| Repo | File | Change |
|------|------|--------|
| Testbench | `TestBench/lib/compose.ts` | Fix absolute-path guard in injectNetwork |
| Testbench (server) | `/data/apps/thementalload/docker-compose.yml` | Build contexts → `./source`, add frontend env vars |
| Testbench (server) | SQLite DB `apps` table | Set `git_url` for `thementalload` |
| ez_TheMentalLoad | `packages/frontend/components/mobile/mobile-settings-content.tsx` | Wire Update button if missing |

---

## Out of Scope

- Merge `feat/apple-calendar-sync` to `main` (separate task).
- Update progress streaming (webhook streams to deploy.log; UI shows a static "rebuilding" message).
- Rollback on failed build.
