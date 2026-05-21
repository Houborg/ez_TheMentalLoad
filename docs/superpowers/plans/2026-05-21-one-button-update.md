# One-Button Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up a one-click Update button in MentalLoad's Developer Settings that git-pulls the repo, rebuilds Docker images, and restarts containers while preserving the PostgreSQL data volume.

**Architecture:** The MentalLoad frontend calls its own `/api/update` route (already written), which HMAC-signs a request to the Testbench webhook (`http://testbench-webhook:9001/app-deploy`). The webhook git-pulls the repo in a `source/` clone directory, then runs `docker compose up -d --build`. Four env vars must be added to the frontend container so the route can reach the webhook. The Testbench's `injectNetwork()` must also be fixed to rewrite absolute build context paths (previously skipped) to `./source` when a git URL is present.

**Tech Stack:** TypeScript, Next.js 16, Node.js built-in test runner (`node:test`), `tsx`, `js-yaml`, Node.js `node:sqlite`, Docker Compose, SSH

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `Testbench/TestBench/lib/compose.ts` | Fix absolute-path guard in `injectNetwork` |
| Create | `Testbench/TestBench/lib/compose.test.ts` | Unit tests for `injectNetwork` absolute-path rewrite |
| Modify | `ez_TheMentalLoad/packages/frontend/components/mobile/mobile-settings-content.tsx` | Add Update button + status to `DeveloperTab` |
| On-server via SSH | `/home/mhouborg/testbench/TestBench/data/apps/thementalload/docker-compose.yml` | Rewrite build contexts → `./source`, add 4 env vars to frontend |
| On-server via SSH | `/home/mhouborg/testbench/TestBench/data/testbench.db` | Set `git_url` for `thementalload` row |
| On-server via SSH | `/home/mhouborg/testbench/TestBench/data/apps/thementalload/source/` | Initial git clone of repo |

---

## Task 1: Fix `injectNetwork` to rewrite absolute build contexts

**Repo:** `C:\Projects\github\Testbench`

**Files:**
- Modify: `TestBench/lib/compose.ts:42-61`
- Create: `TestBench/lib/compose.test.ts`

### Background

`injectNetwork` rewrites relative build contexts to `./source/…` when a git URL is present, but explicitly skips absolute paths (e.g. `/home/mhouborg/ez_TheMentalLoad`). MentalLoad was registered with an absolute local path; those must become `./source` too.

- [ ] **Step 1: Write the failing tests**

Create `TestBench/lib/compose.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { injectNetwork } from "./compose.js";

// Minimal compose with one service having an absolute build context
const absoluteCtxYaml = `
services:
  frontend:
    build:
      context: /home/user/myapp
      dockerfile: packages/frontend/Dockerfile
    environment:
      FOO: bar
`;

// Minimal compose with one service having a relative build context
const relativeCtxYaml = `
services:
  backend:
    build:
      context: packages/backend
      dockerfile: Dockerfile
`;

// Already rewritten — should be idempotent
const alreadySourceYaml = `
services:
  backend:
    build:
      context: ./source/packages/backend
`;

// String-form build context (shorthand: build: ./packages/backend)
const stringCtxYaml = `
services:
  backend:
    build: /home/user/myapp
`;

test("absolute build context is rewritten to ./source when hasGitUrl=true", () => {
  const result = injectNetwork(absoluteCtxYaml, "myapp", "frontend", true);
  assert.match(result, /context: \.\/source\n/);
  assert.doesNotMatch(result, /\/home\/user\/myapp/);
  // dockerfile path is unchanged
  assert.match(result, /dockerfile: packages\/frontend\/Dockerfile/);
});

test("relative build context is rewritten to ./source/packages/backend when hasGitUrl=true", () => {
  const result = injectNetwork(relativeCtxYaml, "myapp", "frontend", true);
  assert.match(result, /context: \.\/source\/packages\/backend/);
});

test("already-rewritten context is unchanged (idempotent)", () => {
  const result = injectNetwork(alreadySourceYaml, "myapp", "frontend", true);
  const count = (result.match(/\.\/source\/packages\/backend/g) ?? []).length;
  assert.equal(count, 1);
});

test("string-form absolute build context is rewritten to ./source", () => {
  const result = injectNetwork(stringCtxYaml, "myapp", "frontend", true);
  assert.match(result, /context: \.\/source/);
  assert.doesNotMatch(result, /\/home\/user\/myapp/);
});

test("build context is NOT rewritten when hasGitUrl=false", () => {
  const result = injectNetwork(absoluteCtxYaml, "myapp", "frontend", false);
  assert.match(result, /\/home\/user\/myapp/);
});
```

- [ ] **Step 2: Add test script to `TestBench/package.json`**

Open `TestBench/package.json` and add to `"scripts"`:
```json
"test": "tsx --test lib/**/*.test.ts"
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd C:\Projects\github\Testbench\TestBench
npm test 2>&1
```

Expected: 2 tests pass (the `hasGitUrl=false` test and idempotent test), 3 fail with "does not match" — the absolute-path tests.

- [ ] **Step 4: Apply the fix to `TestBench/lib/compose.ts`**

Replace lines 42–61 (the `hasGitUrl` block for both build branches):

```typescript
    // Rewrite build contexts to ./source/<path> when deploying from a git repo.
    // Guard against re-prefixing on subsequent calls (idempotency).
    if (hasGitUrl) {
      if (typeof s.build === "string") {
        const ctx = s.build;
        if (!ctx.startsWith("./source") && !ctx.startsWith("source")) {
          if (ctx.startsWith("/")) {
            s.build = { context: "./source" };
          } else {
            const rel = ctx.replace(/^\.\//, "").replace(/^\.$/, "");
            s.build = { context: rel ? `./source/${rel}` : "./source" };
          }
        }
      } else if (s.build && typeof s.build === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = s.build as Record<string, any>;
        const origCtx = typeof b.context === "string" ? b.context : ".";
        if (!origCtx.startsWith("./source") && !origCtx.startsWith("source")) {
          if (origCtx.startsWith("/")) {
            b.context = "./source";
          } else {
            const rel = origCtx.replace(/^\.\//, "").replace(/^\.$/, "");
            b.context = rel ? `./source/${rel}` : "./source";
          }
        }
      }
    }
```

- [ ] **Step 5: Run tests — all 5 must pass**

```bash
cd C:\Projects\github\Testbench\TestBench
npm test 2>&1
```

Expected output:
```
✔ absolute build context is rewritten to ./source when hasGitUrl=true
✔ relative build context is rewritten to ./source/packages/backend when hasGitUrl=true
✔ already-rewritten context is unchanged (idempotent)
✔ string-form absolute build context is rewritten to ./source
✔ build context is NOT rewritten when hasGitUrl=false
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

- [ ] **Step 6: Commit (Testbench repo)**

```bash
cd C:\Projects\github\Testbench
git add TestBench/lib/compose.ts TestBench/lib/compose.test.ts TestBench/package.json
git commit -m "fix(compose): rewrite absolute build contexts to ./source when hasGitUrl"
git push
```

---

## Task 2: Add Update button to mobile Developer tab

**Repo:** `C:\Projects\github\ez_TheMentalLoad`

**Files:**
- Modify: `packages/frontend/components/mobile/mobile-settings-content.tsx:416-443`

### Background

`DeveloperTab` (line 416) shows build info but has no Update button. The desktop view (`dashboard-app.tsx` ~line 3605) already has `handleForceUpdate()`, but the mobile tab is self-contained. We add the button directly in `DeveloperTab` — it makes its own `fetch('/api/update')` call so it doesn't need props from the parent.

- [ ] **Step 1: Replace the `DeveloperTab` function**

Open `packages/frontend/components/mobile/mobile-settings-content.tsx` and replace the entire `DeveloperTab` function (lines 417–443) with:

```tsx
/* ─── Developer ─── */
function DeveloperTab() {
  const [health, setHealth] = useState<{ version?: string; commit?: string; deployedAt?: string | null } | null>(null);
  const [updateState, setUpdateState] = useState<'idle' | 'updating' | 'done' | 'error'>('idle');
  const [updateMessage, setUpdateMessage] = useState('');

  useEffect(() => {
    loadHealth().then(h => setHealth({ version: h.version, commit: h.commit, deployedAt: h.deployedAt })).catch(console.error);
  }, []);

  async function handleUpdate() {
    setUpdateState('updating');
    setUpdateMessage('');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (!res.ok) {
        setUpdateState('error');
        setUpdateMessage(data.message ?? `Error ${res.status}`);
      } else {
        setUpdateState('done');
        setUpdateMessage(data.message ?? 'Update triggered — app will restart in ~3–5 min.');
      }
    } catch (err) {
      setUpdateState('error');
      setUpdateMessage(err instanceof Error ? err.message : 'Could not reach server');
    }
  }

  const frontendCommit = process.env.NEXT_PUBLIC_APP_COMMIT ?? 'local';
  const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Frontend build</div>
        <div className="text-sm font-mono">{frontendVersion} ({frontendCommit})</div>
      </div>
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Server</div>
        {health ? (
          <div className="text-sm font-mono">{health.version ?? '—'} ({health.commit ?? '—'})</div>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <button
        type="button"
        onClick={() => void handleUpdate()}
        disabled={updateState === 'updating'}
        className="rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {updateState === 'updating' && <Loader2 className="h-4 w-4 animate-spin" />}
        {updateState === 'updating' ? 'Opdaterer…' : 'Opdater app'}
      </button>
      {updateMessage && (
        <p className={`text-xs px-1 ${updateState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {updateMessage}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd C:\Projects\github\ez_TheMentalLoad
npx tsc --noEmit -p packages/frontend/tsconfig.json 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd C:\Projects\github\ez_TheMentalLoad
git add packages/frontend/components/mobile/mobile-settings-content.tsx
git commit -m "feat(ui): add Update button to mobile developer settings tab"
git push
```

---

## Task 3: Update server-side compose + DB, then initial clone

**No code changes — all SSH commands.**

This task patches the stored compose file and SQLite DB inside the running testbench container, then clones the MentalLoad repo into `source/` so the webhook has something to pull from on first use.

### 3a — Patch the stored compose

- [ ] **Step 1: Run the patch script inside the testbench container**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "docker exec testbench node -e \"
const fs = require('fs');
const path = '/data/apps/thementalload/docker-compose.yml';
let yaml = fs.readFileSync(path, 'utf8');

// Replace all absolute build contexts with ./source
yaml = yaml.replace(/context: \\/home\\/mhouborg\\/ez_TheMentalLoad/g, 'context: ./source');

// Add env vars to frontend service — insert after the last existing env var line
// Find the NEXT_PUBLIC_WS_URL line in frontend and append after it
const envBlock = [
  '      TESTBENCH_WEBHOOK_URL: http://testbench-webhook:9001',
  '      TESTBENCH_WEBHOOK_SECRET: <WEBHOOK_SECRET>',
  '      APP_SLUG: thementalload',
  '      APP_GIT_URL: https://github.com/Houborg/ez_TheMentalLoad.git',
].join('\n');

// Only inject if not already present
if (!yaml.includes('TESTBENCH_WEBHOOK_URL')) {
  yaml = yaml.replace(
    /(      NEXT_PUBLIC_WS_URL: wss:\/\/mentalload\.pl0k\.online\/ws\n)/,
    '\$1' + envBlock + '\n'
  );
}

fs.writeFileSync(path, yaml);
console.log('Compose updated:');
console.log(yaml.substring(yaml.indexOf('  frontend:'), yaml.indexOf('  frontend:') + 600));
\""
```

Expected: prints the `frontend:` service block showing `./source` context and the 4 new env vars.

- [ ] **Step 2: Verify the compose looks right**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "docker exec testbench grep -E 'context:|TESTBENCH_WEBHOOK|APP_SLUG|APP_GIT_URL' /data/apps/thementalload/docker-compose.yml"
```

Expected output (all three build services show `./source`, frontend has the 4 new vars):
```
    context: ./source
    context: ./source
    context: ./source
      TESTBENCH_WEBHOOK_URL: http://testbench-webhook:9001
      TESTBENCH_WEBHOOK_SECRET: <WEBHOOK_SECRET>
      APP_SLUG: thementalload
      APP_GIT_URL: https://github.com/Houborg/ez_TheMentalLoad.git
```

### 3b — Update the testbench DB

- [ ] **Step 3: Set `git_url` for the `thementalload` app row**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "docker exec testbench node -e \"
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/testbench.db');
const before = db.prepare('SELECT slug, git_url FROM apps WHERE slug = ?').get('thementalload');
console.log('Before:', JSON.stringify(before));
db.prepare(\\\"UPDATE apps SET git_url = ? WHERE slug = ?\\\" ).run('https://github.com/Houborg/ez_TheMentalLoad.git', 'thementalload');
const after = db.prepare('SELECT slug, git_url FROM apps WHERE slug = ?').get('thementalload');
console.log('After:', JSON.stringify(after));
\""
```

Expected:
```
Before: {"slug":"thementalload","git_url":null}
After: {"slug":"thementalload","git_url":"https://github.com/Houborg/ez_TheMentalLoad.git"}
```

### 3c — Initial git clone into `source/`

The webhook will `git clone` automatically on first deploy, but only to its default branch (`main`). Since all our recent work is on `feat/apple-calendar-sync`, clone it manually to that branch first so subsequent `git pull` calls pull the right code.

- [ ] **Step 4: Clone the repo into `source/` on the correct branch**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "git clone --branch feat/apple-calendar-sync https://github.com/Houborg/ez_TheMentalLoad.git /home/mhouborg/testbench/TestBench/data/apps/thementalload/source && git -C /home/mhouborg/testbench/TestBench/data/apps/thementalload/source log --oneline -3"
```

Expected: clones successfully and shows recent commits from `feat/apple-calendar-sync`.

---

## Task 4: Deploy the Testbench fix + trigger initial MentalLoad rebuild

- [ ] **Step 1: Deploy updated Testbench to server**

The `injectNetwork` fix needs to be running on the server so future compose regenerations produce `./source` paths automatically. Pull the latest code and trigger the Testbench self-deploy webhook:

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "cd /home/mhouborg/testbench && git pull"
```

Then trigger the Testbench self-rebuild:

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> '
SECRET="<WEBHOOK_SECRET>"
BODY="{}"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed "s/.*= //")
curl -s -X POST http://localhost:9001/deploy \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
'
```

Expected: `OK`. The testbench rebuild takes ~1–2 minutes. Wait, then verify it is still running:

```bash
sleep 90 && ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "docker ps --filter name=testbench --format '{{.Names}}\t{{.Status}}'"
```

Expected: `testbench   Up N seconds`.

- [ ] **Step 2: Trigger first MentalLoad rebuild via webhook**

The source/ directory now exists with `.git`, so the webhook will do `git pull` (not clone) and then rebuild:

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> '
SECRET="<WEBHOOK_SECRET>"
BODY='"'"'{"slug":"thementalload","gitUrl":"https://github.com/Houborg/ez_TheMentalLoad.git","gitToken":null}'"'"'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed "s/.*= //")
curl -s -X POST http://localhost:9001/app-deploy \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY"
'
```

Expected: `OK`

- [ ] **Step 3: Watch the deploy log**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "
for i in \$(seq 1 72); do
  sleep 5
  LOG=\$(cat /home/mhouborg/testbench/TestBench/data/apps/thementalload/deploy.log)
  if echo \"\$LOG\" | grep -qE '\[DONE\]|\[FAILED\]'; then
    echo \"\$LOG\" | tail -15
    exit 0
  fi
  if [ \$((i % 6)) -eq 0 ]; then echo \"Waiting... \$((i*5))s\"; fi
done
"
```

Expected: ends with `[DONE]`.

- [ ] **Step 4: Health check**

```bash
sleep 10 && curl -s https://mentalload.pl0k.online/login -I --max-time 10 | head -3
```

Expected: `HTTP/1.1 200 OK`.

---

## Task 5: End-to-end smoke test

- [ ] **Step 1: Open MentalLoad in browser**

Navigate to `https://mentalload.pl0k.online`, log in.

- [ ] **Step 2: Open Developer Settings**

Go to Settings → Udvikler tab. Confirm:
- Frontend build version shown
- Server version shown
- **"Opdater app"** button visible

- [ ] **Step 3: Press Update**

Click **Opdater app**. Confirm:
- Button shows spinner + "Opdaterer…"
- After a moment: message "Update triggered — app will restart in ~3–5 min."

- [ ] **Step 4: Watch deploy log to confirm rebuild**

```bash
ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no mhouborg@<SERVER_IP> "tail -f /home/mhouborg/testbench/TestBench/data/apps/thementalload/deploy.log"
```

Expected: shows `git pull` → docker build → `[DONE]`.

- [ ] **Step 5: Confirm app comes back up after rebuild**

```bash
sleep 15 && curl -s https://mentalload.pl0k.online/login -I --max-time 15 | head -3
```

Expected: `HTTP/1.1 200 OK`.

---

## Notes

- **Data safety:** `docker compose up -d --build` never removes named volumes. `thementalload_postgres_data` (events, members, sync connections) is safe across every update.
- **Branch:** The `source/` clone tracks `feat/apple-calendar-sync`. Once that branch is merged to `main`, `git pull` will naturally track main.
- **Secret in compose:** `TESTBENCH_WEBHOOK_SECRET` is stored in plaintext in the compose env. This is acceptable since the compose file is on the server (not in the repo) and the secret is already visible via `docker inspect testbench`.
