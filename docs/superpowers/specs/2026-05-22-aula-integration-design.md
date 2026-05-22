# Aula Integration — Design Spec

**Date:** 2026-05-22
**Status:** Approved — ready for implementation planning

---

## Goal

Bring kids' school data from the Danish Aula platform into MentalLoad: calendar events, daily overviews, posts/announcements, and messages. Each family connects their own Aula account via a guided wizard, maps Aula children to MentalLoad members, and chooses what to sync.

---

## Approach

**Custom thin TypeScript Aula client** — no external Aula library dependency. The auth flow and API endpoints are fully documented via the scaarup/aula Home Assistant integration (61 releases, actively tracking Aula API changes). We port the relevant parts to TypeScript and own it.

Reference: https://github.com/scaarup/aula

No sidecar container. All code lives in `packages/backend/src/aula/`.

---

## Authentication

Aula uses an 8-step PKCE + SAML + OAuth2 chain ending in standard access/refresh tokens.

### Method: TOKEN (primary)

User provides three credentials at setup time:
- **MitID username** — their MitID login name
- **MitID password**
- **MitID 6-digit code** — from MitID app or hardware token at the moment of setup

The backend runs the full 8-step flow synchronously and returns `{ access_token, refresh_token, expires_at }`. No polling, no QR codes, no Redis session.

### Method: APP/QR (future)

User scans two QR codes with MitID app. More complex (requires polling + Redis session). Not in scope for v1 — TOKEN method is sufficient.

### Auth flow (8 steps, implemented in `aula-auth.ts`)

1. Generate PKCE parameters, visit `https://login.aula.dk/simplesaml/module.php/oidc/authorize.php`
2. Follow SAML redirect chain toward MitID
3. Reach `https://broker.unilogin.dk` — Identity Provider selection
4. POST to `https://nemlog-in.mitid.dk/login/mitid/initialize` — get `authenticationSessionId`
5. Authenticate with TOKEN method: submit username + password + code
6. POST SAML response to `https://broker.unilogin.dk/auth/realms/broker/broker/nemlogin3/endpoint` — role selection (KONTAKT)
7. POST SAML to `https://login.aula.dk/simplesaml/module.php/saml/sp/saml2-acs.php/uni-sp` — get OAuth `code`
8. POST to `https://login.aula.dk/simplesaml/module.php/oidc/token.php` — exchange code for tokens

```
client_id: "_99949a54b8b65423862aac1bf629599ed64231607a"
```

### Token refresh

Standard OAuth2 refresh token grant — POST to the same token endpoint with `grant_type=refresh_token`. The worker refreshes proactively when `expires_at` is within 5 minutes.

---

## Data Model

### Aula Connection (stored in `families.settings_json.aula_connection`)

One connection per family, stored in the same `settings_json` JSONB column used by CalDAV.

```typescript
interface AulaConnection {
  id: string;
  isConnected: boolean;
  aulaUsername: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;         // ISO — worker refreshes proactively
  childMappings: Array<{
    aulaChildId: number;
    aulaChildName: string;
    mentalLoadMemberId: string;
    calendarId: string;
  }>;
  syncOptions: {
    importToCalendar: boolean;    // master gate — off by default during dev
    calendarEvents: boolean;
    dailyOverview: boolean;
    posts: boolean;
    messages: boolean;
  };
  syncIntervalMinutes: number;    // default: 60
  lastSyncAt?: string;
  lastSyncStats?: {
    entriesCreated: number;
    itemsCreated: number;
  };
  createdAt: string;
}
```

### New table: `aula_items` (migration 013)

Stores non-calendar Aula data that does not map to MentalLoad entries.

```sql
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

Aula calendar events → MentalLoad `entries` table via existing `externalUid` dedup. `externalUid` set to `aula-{aulaEventId}`. Owner + calendar from child→member mapping. Only written when `syncOptions.importToCalendar = true`.

---

## Backend Architecture

### New directory: `packages/backend/src/aula/`

**`aula-auth.ts`**
Implements the 8-step login flow and token refresh. No external Aula library.
- `login(username, password, code)` → `{ accessToken, refreshToken, expiresAt }`
- `refresh(refreshToken)` → `{ accessToken, refreshToken, expiresAt }`
- Uses Node.js `fetch` with cookie jar (`tough-cookie` or manual cookie handling)
- Follows redirects manually where needed (SAML chain)

**`aula-client.ts`**
Authenticated Aula API client. Takes stored tokens, calls Aula's REST API.
- Proactive token refresh before each call if within 5 min of expiry
- Throws `AulaAuthExpiredError` if refresh fails
- Methods:
  - `getChildren()` → child profiles for this guardian
  - `getCalendarEvents(childIds, profileIds, from, to)` → events
  - `getDailyOverview(childIds)` → attendance/presence
  - `getThreads(limit)` → message threads
  - `getMessagesForThread(threadId)` → thread messages
  - `getPosts(limit)` → class news/announcements

**Aula API base:** `https://www.aula.dk/api/v22`
All requests: `?method={method}&access_token={token}` (token as query param, not header — setting both causes 400)

**`aula-connection-service.ts`**
CRUD for `aula_connection` in `families.settings_json`. Same pattern as `SyncConnectionService`.
- `getConnection(familyId)` → `AulaConnection | null`
- `saveConnection(familyId, conn)`
- `deleteConnection(familyId)`
- `updateSyncStats(familyId, stats)`

**`aula-sync-service.ts`**
One sync run for a family:
1. Load connection — skip if not connected
2. Instantiate `AulaClient` with stored tokens (refreshes if needed, saves new tokens back)
3. Per child mapping:
   - `calendarEvents` + `importToCalendar`: fetch events (lastSyncAt → now+365d), dedup by `externalUid`, create entries
   - `dailyOverview`: fetch, upsert into `aula_items`
4. `posts`: fetch, upsert into `aula_items`
5. `messages`: fetch threads + messages, upsert into `aula_items`
6. Update `lastSyncAt` + `lastSyncStats`

**`aula-routes.ts`**
Fastify plugin registered in `app.ts`. All routes JWT-authenticated, family-scoped.

---

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/aula/auth/verify` | Run login flow with credentials. Returns children list on success. |
| `POST` | `/api/v1/aula/connect` | Save connection: tokens + child→member mappings + sync options. |
| `GET` | `/api/v1/aula/connection` | Get current connection (tokens stripped). |
| `DELETE` | `/api/v1/aula/connection` | Disconnect. |
| `POST` | `/api/v1/aula/sync` | Trigger manual sync. Returns stats. |
| `GET` | `/api/v1/aula/items` | Paginated `aula_items`. Supports `?type=post&memberId=`. |

### Auth flow (simplified — no Redis, no polling)

`POST /auth/verify` with `{ username, password, code }`:
- Runs `aulaAuth.login(username, password, code)` — ~2-3 seconds
- On success: fetches children list, returns `{ children: [...], tokens: { accessToken, refreshToken, expiresAt } }`
- Tokens held client-side until `POST /connect` is submitted

`POST /connect` with `{ tokens, childMappings, syncOptions }`:
- Saves full `AulaConnection` to `families.settings_json`

---

## Sync Worker

`sync-worker.ts` extended with a second loop running every 60 seconds:

```typescript
setInterval(() => {
  runAulaSyncForAllFamilies().catch(err => console.error('[aula-worker]', err));
}, 60_000);
```

Queries all families, checks `minutesSinceLast >= syncIntervalMinutes`, runs `AulaSyncService.runSync(familyId)`.

---

## Frontend

### New settings tab: "Aula"

Added to mobile settings alongside the existing "Synkronisering" tab.

### Setup wizard — 5 steps

**Step 1 — Intro**
- What it does: henter skema, opslag og beskeder fra Aula
- "Tilknyt Aula" button

**Step 2 — MitID login**
- Simple form: MitID brugernavn, adgangskode, 6-cifret kode
- Note: "Åbn MitID-appen og find din 6-cifrede kode"
- "Log ind" button — calls `POST /aula/auth/verify`
- Loading spinner during 2-3 second auth flow
- Clear error messages: wrong credentials, expired code, connection error

**Step 3 — Map children to members**
- Lists Aula children from `/auth/verify` response (cached in component state)
- Each child: name + member dropdown + "Spring over"
- At least one mapping required

**Step 4 — Sync options**
Toggles (calendarEvents on by default, rest off):
- Kalenderbegivenheder
- Dagsoverblik
- Opslag
- Beskeder
- **Importer til kalender** — dev gate, off by default, labelled clearly

**Step 5 — Done**
- Connected indicator + summary of mappings
- "Synkroniser nu" button
- Disconnect option

### Connected state (replaces wizard)
- Connected badge, last sync time, per-type item counts
- Edit mappings (re-opens step 3+4)
- Manual sync button
- Disconnect with confirmation

---

## Error handling

| Error | Behaviour |
|-------|-----------|
| Wrong MitID credentials | Return 401, show "Forkert brugernavn eller adgangskode" |
| Expired 6-digit code | Return 400, show "Koden er udløbet — hent en ny i MitID-appen" |
| Token refresh fails | Set `isConnected: false`, show reconnect prompt in settings |
| Aula API error during sync | Log, skip run, do not crash worker |
| API version bump (v22 → v23) | Log version error, set `isConnected: false`, notify user |
| Child mapping missing member | Skip child, log warning |
| Duplicate `externalUid` | Skip silently |

---

## Out of scope (v1)

- APP/QR method (MitID app scan) — TOKEN method is sufficient for v1
- Bidirectional sync — Aula API is read-only for parents
- Desktop UI — mobile-only for now
- Step-up auth (sensitive message threads)
- AULA child login (guardian only)

---

## Implementation notes

- Cookie handling during the 8-step auth flow: use `tough-cookie` or manual cookie jar
- Mobile Android user-agent required for Aula API requests (detected by server)
- API version `v22` — if Aula bumps to v23, version constant is in one place (`aula-client.ts`)
- No new npm package dependency beyond `tough-cookie` (lightweight, widely used)
