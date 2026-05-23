# Aula Integration — Handoff (2026-05-23)

## Status: Auth working end-to-end, sync routed through Python sidecar — needs testing

---

## What works ✅

1. **MitID APP authentication**: User enters MitID username → Næste → scans QR codes in MitID app → auth completes
2. **Children fetching**: After auth, the Python `aula` library fetches the 3 children: Emil Vedstesen Houborg, Nynne Vedstesen Houborg, Saga Vedstesen Houborg
3. **Connection storage**: Tokens + full `token_data` JSON blob saved in `families.settings_json.aula_connection`
4. **Connected state UI**: Shows "Tilknyttet Aula" with sync button + disconnect

## What was just deployed (needs testing) 🧪

**Architecture change:** Sync now routes through Python sidecar instead of TypeScript REST client.

- **Sidecar** (`mentalload-aula-sidecar`): exposes `POST /fetch-data` that uses the Python library's `AulaApiClient.get_calendar_events()`, `get_posts()`, `get_message_threads()`, `get_daily_overview()`
- **Backend** (`AulaSyncService`): calls sidecar `/fetch-data` instead of direct Aula REST API (which returned 410 due to missing session cookies)
- **Connection model**: Now stores `tokenData` (full FileTokenStorage blob) in addition to access/refresh tokens

## To test 🔍

User needs to **disconnect and reconnect** their Aula account to populate the new `tokenData` field:

1. Open Settings → Aula tab → "Afbryd forbindelse" (disconnect)
2. Reconnect via the wizard (scan QR codes again)
3. Manual sync via "Synkroniser nu" button
4. Check **Settings → Aula Data tab** (new dev viewer) — should show items grouped by child

Check sidecar logs: `docker logs mentalload-aula-sidecar | grep fetch-data`

## Key files

**Sidecar:**
- `packages/aula-sidecar/main.py` — has monkey-patches for `_step4` (ASP.NET inline redirect handling), `_poll_for_app_confirmation` (handles `OK + confirmation:False`), and `finalize_authentication_and_get_authorization_code` (logging). Also has `/fetch-data` endpoint.
- `packages/aula-sidecar/Dockerfile` — Python 3.14-slim base
- `packages/aula-sidecar/requirements.txt` — `aula`, `fastapi`, `uvicorn[standard]`, `qrcode[pil]`, `Pillow`

**Backend:**
- `packages/backend/src/aula/aula-types.ts` — `AulaConnection` now has optional `tokenData: Record<string, unknown>`
- `packages/backend/src/aula/aula-auth.ts` — `aulaAuthStart/Poll` (no more direct MitID handling)
- `packages/backend/src/aula/aula-sync-service.ts` — fully rewritten to call sidecar `/fetch-data`
- `packages/backend/src/aula/aula-routes.ts` — saves `tokenData` in connect route
- `packages/backend/src/aula/aula-client.ts` — **NO LONGER USED for sync**; can be deleted but kept as reference
- `packages/backend/migrations/013_aula_items.sql` — applied

**Frontend:**
- `packages/frontend/components/mobile/mobile-aula-settings.tsx` — captures `tokenData` from poll result, passes to `aulaConnect`
- `packages/frontend/components/aula-data-viewer.tsx` — new "Aula Data" tab in desktop settings
- `packages/frontend/components/dashboard-app.tsx` — Aula + Aula Data tabs added
- `packages/frontend/lib/aula-api.ts` — `aulaConnect` accepts `tokenData`

## Known issues / TODO 📋

1. **Old connections** (created before this change) have no `tokenData` → sync will log warning and return 0/0. **Fix: user must disconnect + reconnect.**
2. **Field name mapping in sidecar `/fetch-data`** is speculative — uses `getattr(ev, 'start_datetime', '') or getattr(ev, 'start', '')`. May need adjustment once we see real data. Check logs for `[fetch-data]` entries.
3. **No QR cleanup**: if user abandons login flow, session lingers in sidecar memory for 5 min TTL (acceptable).
4. **Refresh token flow untested**: `aulaRefresh()` in `aula-auth.ts` calls Aula directly with `grant_type=refresh_token`. May 401 if API requires session cookies — would need to also route through sidecar if it fails.
5. **getProfilesByLogin → 410**: The old TypeScript `AulaClient` is unused now but still in repo. Not a bug, just dead code.

## Server deployment paths

- **Source clone (read by Docker build):** `/repo/TestBench/data/apps/mentalload/source` (inside testbench-webhook container)
- **Compose file (managed by Testbench):** `~/testbench/TestBench/data/apps/mentalload/docker-compose.yml`
- **Source of truth for that compose file:** SQLite DB at `/data/testbench.db` inside the `testbench` container, table `apps`, column `compose_yaml_raw` (slug = `mentalload`). Testbench regenerates the on-disk file from this column via `injectNetwork()` on every redeploy, so **hand-edits to the on-disk file are ephemeral** — always update the DB. Use `docker exec testbench node --experimental-sqlite` to read/write.
- **To deploy after git push:**
  ```bash
  ssh mhouborg@192.168.1.252 "
    docker exec testbench-webhook git -C /repo/TestBench/data/apps/mentalload/source pull origin main
    docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload build aula-sidecar backend
    docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d aula-sidecar backend
  "
  ```
- **Frontend needs `--no-cache` rebuild** for Next.js to pick up changes:
  ```bash
  ssh mhouborg@192.168.1.252 "docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload build --no-cache frontend && docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d frontend"
  ```

## Recent commits (latest first)

- `1fc20cd` feat: route Aula data fetching through Python sidecar to fix 410; store tokenData; Aula Data viewer tab
- `da8a59b` feat: Aula Data viewer tab — items grouped by child, filterable by type
- `7522ebd` fix: pass qrCodes (children) through on completed poll result
- `ad07a1f` fix: use create_client() to fetch children after auth; fix token file lifetime
- `a8a7f5f` fix: handle OK+confirmation:False in poll; fetch children via sidecar client; avoid 410
- `570ffb2` fix: larger QR code (box_size=12) + bigger display (w-56)
- `e3a7b88` fix: handle ASP.NET inline loginoption redirect in step4

## Next concrete steps

1. **User disconnects + reconnects** Aula via the wizard
2. **Click "Synkroniser nu"** in connected state
3. **Check sidecar logs** for `[fetch-data]` output:
   - `docker logs mentalload-aula-sidecar --tail 30 2>&1 | grep fetch-data`
4. **Check Aula Data tab** in desktop settings — items should appear grouped by child
5. If `[fetch-data]` shows errors like "X has no attribute Y", adjust field names in `packages/aula-sidecar/main.py` `fetch_data` function based on what the actual Python objects expose
6. Once sync works, **flip `importToCalendar` to true** in sync options to see Aula calendar events appear in the main MentalLoad calendar

---

## Resume state — 2026-05-23 (after first deploy)

### What's been fixed since the original handoff
- `mentalload-aula-sidecar` added to the Testbench-managed compose **and persisted in the Testbench SQLite DB** (`apps.compose_yaml_raw` for slug `mentalload`) so it survives redeploys.
- Backend wired with `AULA_SIDECAR_URL=http://mentalload-aula-sidecar:8765`.
- `aula-sync-service.ts` no longer swallows errors; route returns 502 with message; mobile UI shows the real toast.
- Missing-tokenData case throws an explicit Danish "afbryd og forbind igen" error.
- `apiFetch` no longer sets `Content-Type: application/json` when DELETE has no body (fix for Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` 400 on disconnect).
- Sidecar `/fetch-data` rewritten against the real `aula` Python library signatures (we introspected `inspect.signature` and `dataclasses.fields` from inside the container):
  - `get_calendar_events(institution_profile_ids=[child_id], start=<datetime>, end=<datetime>)`
  - `get_daily_overview(child_id=<int>)` — per-child, not plural
  - `get_posts(institution_profile_ids=req.child_ids)`
  - `get_message_threads()` + `get_messages_for_thread(thread_id=…, limit=1)` for body
  - Field names: `start_datetime`, `end_datetime`, `content_html`, `timestamp`, etc.
- DailyOverview's `entry_time` is HH:MM:SS only in this institution; we now stamp overviews with today's UTC date.
- Backend's `upsertAulaItem` runs `publishedAt` through `Date.parse()` and stores null on any unparseable value.

### What works now (latest verified sync)
```
[fetch-data] events=0 overviews=2 posts=0 msgs=20  → POST /fetch-data 200 OK
```

### What's still broken
1. **Calendar events return HTTP 403 for every child** — `[fetch-data] calendar events for child <id>: HTTP 403`. Auth was good (we got tokens + 3 children), but the calendar endpoint refuses. May be an institution-level permission, may need a different `start`/`end` format, may need different scopes. Untriaged.
2. **Posts: 0** — need to check whether `get_posts(institution_profile_ids=…)` is actually returning, or if it's erroring (no log was visible in the last run). Possible Pydantic parse failure.
3. **Calendar entries don't yet appear in MentalLoad calendar** — `syncOptions.importToCalendar` is still false by default. Once events fetch, flip this.

### Where we are
User reconnected, sync ran, daily overviews + messages persisted. Calendar/posts pending. Taking a 2h+ break — when picking back up, fix calendar 403 first (probably needs `start`/`end` as ISO with tz, or library has a different per-child calendar endpoint).
