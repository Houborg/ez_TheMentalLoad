# Aula Integration — Design Spec

**Date:** 2026-05-22
**Status:** Approved — ready for implementation planning

---

## Goal

Bring kids' school data from the Danish Aula platform into MentalLoad: calendar events, daily overviews, posts/announcements, and messages. Each family connects their own Aula account via a guided MitID wizard, maps Aula children to MentalLoad members, and chooses what to sync.

---

## Approach

**Option B — Dedicated Aula service.** Aula runs as a parallel sync infrastructure alongside the existing CalDAV sync. No shared abstraction with CalDAV — the data shapes and auth model are too different.

`@aula-mcp/aula-client` (from github.com/Casperjuel/aula-mcp) is imported as a library into MentalLoad's backend. No sidecar container.

---

## Data Model

### Aula Connection (stored in `families.settings_json.aula_connection`)

One connection per family. Stored in the same `settings_json` JSONB column used by CalDAV connections.

```typescript
interface AulaConnection {
  id: string;
  isConnected: boolean;
  aulaUsername: string;
  accessToken: string;          // OAuth2 access token
  refreshToken: string;         // OAuth2 refresh token — long-lived
  tokenExpiresAt: string;       // ISO timestamp — worker refreshes before expiry
  childMappings: Array<{
    aulaChildId: number;
    aulaChildName: string;
    mentalLoadMemberId: string;
    calendarId: string;         // which MentalLoad calendar to write events into
  }>;
  syncOptions: {
    importToCalendar: boolean;  // master gate — off by default during dev
    calendarEvents: boolean;
    dailyOverview: boolean;
    posts: boolean;
    messages: boolean;
  };
  syncIntervalMinutes: number;  // default: 60
  lastSyncAt?: string;
  lastSyncStats?: {
    entriesCreated: number;
    itemsCreated: number;
  };
  createdAt: string;
}
```

### New table: `aula_items`

Stores non-calendar Aula data (posts, messages, daily overviews) that do not map to MentalLoad entries.

```sql
-- Migration 013_aula_items.sql
create table if not exists aula_items (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  aula_id      text not null,
  type         text not null check (type in ('post', 'message', 'daily_overview')),
  title        text,
  body         text,
  author       text,
  member_id    uuid references members(id) on delete set null,
  published_at timestamptz,
  raw_json     jsonb,
  created_at   timestamptz not null default now(),
  unique(family_id, aula_id, type)
);

create index if not exists idx_aula_items_family on aula_items(family_id);
create index if not exists idx_aula_items_published on aula_items(family_id, published_at desc);
```

### Calendar events

Aula calendar events are written to the MentalLoad `entries` table using the existing `externalUid` dedup mechanism. `externalUid` is set to `aula-{aulaEventId}`. Owner and calendar are set from the child→member mapping. Only written when `syncOptions.importToCalendar = true`.

---

## Backend Architecture

### New directory: `packages/backend/src/aula/`

**`aula-adapter.ts`**
Wraps `@aula-mcp/aula-client`. Responsible for:
- Creating an authenticated `AulaClient` from stored tokens
- Proactive token refresh (if `tokenExpiresAt` is within 5 minutes, refresh before use)
- Typed fetch methods: `fetchCalendarEvents(childIds, from, to)`, `fetchDailyOverview(childIds)`, `fetchPosts(limit)`, `fetchMessages(limit)`, `fetchChildren()`
- Throws a typed `AulaAuthExpiredError` if refresh fails (triggers reconnect prompt in UI)

**`aula-connection-service.ts`**
CRUD for the `aula_connection` stored in `families.settings_json`. Same pattern as `SyncConnectionService`.
- `getConnection(familyId)` → `AulaConnection | null`
- `saveConnection(familyId, connection)` → writes to settings_json
- `deleteConnection(familyId)` → removes key from settings_json
- `updateSyncStats(familyId, stats)` → updates lastSyncAt + lastSyncStats

**`aula-sync-service.ts`**
Sync logic for one family run:
1. Load connection, skip if not connected
2. Instantiate `AulaAdapter` with stored tokens (refreshes if needed)
3. For each child mapping:
   - If `calendarEvents` enabled + `importToCalendar` enabled: fetch events for date range (lastSyncAt → now+365d), dedup by `externalUid`, create missing entries
   - If `dailyOverview` enabled: fetch overview, upsert into `aula_items`
4. If `posts` enabled: fetch posts, upsert into `aula_items`
5. If `messages` enabled: fetch message threads, upsert into `aula_items`
6. Update `lastSyncAt` + `lastSyncStats`

**`aula-routes.ts`**
Fastify plugin registered in `app.ts`. All routes require JWT auth. Family ID scoped from JWT.

---

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/aula/auth/start` | Start MitID flow. Stores in-progress state in Redis (5 min TTL, family-scoped key). Returns session ID. |
| `GET` | `/api/v1/aula/auth/poll/:sessionId` | Poll auth state. Returns `{ status: 'pending' \| 'qr_ready' \| 'authenticated' \| 'error', qrPayloads?, children? }` |
| `POST` | `/api/v1/aula/connect` | Save confirmed connection: child→member mappings + sync options. Clears Redis session. |
| `GET` | `/api/v1/aula/connection` | Get current connection (tokens stripped). |
| `DELETE` | `/api/v1/aula/connection` | Disconnect — removes from settings_json. |
| `POST` | `/api/v1/aula/sync` | Trigger manual sync. Returns stats. |
| `GET` | `/api/v1/aula/items` | Paginated list of `aula_items` for this family. Supports `?type=post&memberId=`. |

### MitID QR flow (stateful)

`POST /auth/start`:
- Generates a `sessionId` (UUID)
- Starts `AulaLoginClient.login()` in a background async task
- The task pauses at the QR step and writes `{ status: 'qr_ready', qrPayloads: [...] }` to Redis under `aula-auth:{familyId}:{sessionId}`
- Returns `{ sessionId }`

`GET /auth/poll/:sessionId`:
- Reads state from Redis
- Returns current status + QR payloads when ready
- On `authenticated`: returns children list, stores tokens temporarily in Redis
- Frontend moves to child mapping step

`POST /connect`:
- Reads tokens from Redis (set by poll when authenticated)
- Saves full `AulaConnection` to `families.settings_json`
- Clears Redis session

---

## Sync Worker

`sync-worker.ts` extended with a second polling loop:

```typescript
// Runs every 60 seconds — same cadence as CalDAV sync
setInterval(() => {
  runAulaSyncForAllFamilies().catch(err => console.error('[aula-worker]', err));
}, 60_000);
```

`runAulaSyncForAllFamilies()` queries all families, loads their `aula_connection`, checks `minutesSinceLast >= syncIntervalMinutes`, runs `AulaSyncService.runSync(familyId)`.

---

## Frontend

### New settings tab: "Aula"

Added to the mobile settings screen alongside the existing "Synkronisering" (Apple Calendar) tab.

### Setup wizard — 5 steps

**Step 1 — Intro**
- Brief explanation: henter skema, opslag og beskeder fra Aula
- "Tilknyt Aula" button

**Step 2 — MitID login**
- Calls `POST /aula/auth/start`, gets sessionId
- Polls `/aula/auth/poll/:sessionId` every 2 seconds
- Renders **two QR codes** using `qrcode` npm package — MitID channel binding splits into two halves, both must be scanned in sequence
- States: scanning (spinner overlay when `channel_verified`), success tick, timeout retry
- 5-minute timeout with "Prøv igen" button
- When poll returns `status: 'authenticated'`, children list is stored in component state before advancing to step 3

**Step 3 — Map children to members**
- Lists Aula children cached from the authenticated poll response (no extra API call needed)
- Each child: name + dropdown of MentalLoad members + "Spring over"
- At least one mapping required to proceed
- Validation inline

**Step 4 — Sync options**
Toggles (all off by default except calendarEvents):
- Kalenderbegivenheder
- Dagsoverblik
- Opslag
- Beskeder
- **Importer til kalender** (dev gate — off by default, clearly labelled)

**Step 5 — Done**
- Green connected indicator
- Summary of mappings
- "Synkroniser nu" button
- Disconnect option

### Connected state (replaces wizard)
- Shows: connected badge, last sync time, per-type item counts
- Edit mappings button (re-opens step 3+4)
- Manual sync button
- Disconnect button (with confirmation)

---

## New npm dependency

`@aula-mcp/aula-client` and `@aula-mcp/aula-auth` — installed into `packages/backend`.

These are workspace packages in the aula-mcp monorepo. They will need to be consumed either by:
- Installing from GitHub (`github:Casperjuel/aula-mcp#main` with workspace path)
- Or copying the compiled packages

**Decision deferred to implementation** — verify the best install method during Task 1.

---

## Error handling

| Error | Behaviour |
|-------|-----------|
| Token refresh fails | Set `isConnected: false`, surface reconnect prompt in settings |
| Aula API error during sync | Log, skip this sync run, do not crash worker |
| MitID timeout (5 min) | Redis TTL expires, poll returns `error`, frontend shows retry |
| Child mapping missing member | Skip that child during sync, log warning |
| Duplicate `externalUid` | Skip silently (existing dedup logic) |

---

## Out of scope

- Bidirectional sync (export MentalLoad events to Aula) — Aula's API is read-only for parents
- Desktop UI — Aula tab is mobile-only for now
- CalDAV server (MentalLoad as a CalDAV server) — separate future feature
- AULA step-up authentication (sensitive message threads requiring fresh MitID) — skipped silently

---

## Open questions (deferred to implementation)

1. How to install `@aula-mcp/aula-client` — GitHub package or copy compiled output?
2. Exact token lifetime of Aula OAuth tokens (test during implementation)
3. Whether `getDailyOverview` returns per-child data or family-level data
