# Apple Calendar Sync — Design Spec
_Date: 2026-05-21_

## Goal

Replace the raw developer sync form in Settings with a polished, guided experience that walks a family through connecting Apple Calendar (bidirectional via CalDAV). The architecture must support multiple providers co-existing (e.g. father on Apple, mother on Google later), all scoped per family.

---

## Scope

**In scope (this iteration):**
- Redesigned sync settings page (layout C + wizard)
- Apple Calendar via CalDAV + app-specific password
- Import (Apple → MentalLoad) and export (MentalLoad → Apple), each independently toggleable
- Multi-connection data model (replaces single-provider model)
- Background auto-sync worker (15-min default) + manual sync now
- Advanced settings collapse for power users
- Backwards-compatible migration of existing sync config

**Out of scope (future):**
- Google Calendar (architecture ready, UI placeholder only)
- Outlook
- Per-member connections (current model is per-family)
- Conflict resolution UI (last-write-wins for now)

---

## Page Structure

The sync settings page uses a **split layout**:

### Left sidebar
Compact list of sync connections. Each entry shows:
- Provider icon + name
- Green dot (connected) or grey dot (not connected)
- `+ Add` button at the bottom

On mobile: collapses to a horizontal pill selector above the panel.

### Right panel — connected state
When a connection is selected and active:
- Provider name + "Connected" badge
- Last sync timestamp
- Bidirectional status
- **Sync now** button
- **Reconfigure** button (launches the wizard inline)
- `▸ Advanced settings` collapsible section (see below)

### Right panel — wizard state
Triggered on first connect or when **Reconfigure** is pressed. Renders the step-by-step wizard inline in the right panel. Step indicator at the top, one step at a time.

---

## Apple Calendar Wizard — 5 Steps

### Step 1 — Apple ID
- Input: iCloud email address (Apple ID)
- Hint: "Usually ending in @icloud.com, @me.com, or your own email"
- Note: your main Apple ID password is never stored — MentalLoad uses a separate app-specific password (created in step 2) which is stored encrypted in the database to enable background syncing

### Step 2 — App-specific password
- Numbered guide with a direct link to `appleid.apple.com`:
  1. Open appleid.apple.com and sign in
  2. Sign-In and Security → App-Specific Passwords
  3. Click `+`, name it `MentalLoad`
  4. Copy the password (format: `xxxx-xxxx-xxxx-xxxx`)
- Input: password field
- Action button: **Connect & verify** (hits CalDAV, confirms credentials before proceeding)

### Step 3 — Pick calendar
- MentalLoad fetches the list of available calendars from `caldav.icloud.com` using the credentials from steps 1–2
- Displays calendar name + event count for each
- User selects one calendar to sync

### Step 4 — Sync direction
- Toggle: **Import from Apple Calendar** (Apple → MentalLoad) — on by default
- Toggle: **Export to Apple Calendar** (MentalLoad → Apple) — on by default
- Note: both on = fully bidirectional; import-only is the safe option

### Step 5 — Success
- Confirmation summary: Apple ID, calendar name, direction, events imported, next sync interval
- Hint: "Want to add Google Calendar for another family member? Use + Add in the sidebar."
- Done button returns to the connected card view

---

## Data Model

### Current (single provider per family)
```json
// families.settings_json.sync
{
  "provider": "apple",
  "isConnected": true,
  "configJson": { "feedUrl": "...", "calendarId": "..." }
}
```

### New (multiple connections)
```json
// families.settings_json.sync_connections
[
  {
    "id": "conn_apple_1",
    "provider": "apple",
    "isConnected": true,
    "importEnabled": true,
    "exportEnabled": true,
    "appleId": "far@icloud.com",
    "caldavUrl": "https://caldav.icloud.com/",
    "appPassword": "xxxx-xxxx-xxxx-xxxx",
    "calendarPath": "/dav/principals/user/far@icloud.com/calendars/home/",
    "calendarName": "Far's Calendar",
    "syncIntervalMinutes": 15,
    "lastSyncAt": "2026-05-21T10:00:00Z",
    "lastImportCount": 34
  }
]
```

### Migration
- New DB migration (`012_sync_connections.sql`): no schema change needed — `settings_json` is already JSONB
- Migration script runs at startup:
  - If `settings_json.sync.provider` is `none` or absent: set `sync_connections = []` and remove `sync` key
  - Otherwise: move `settings_json.sync` to `sync_connections[0]` with a generated id, map old `feedUrl`/`calendarId` to new shape as best-effort, mark `isConnected = false` (user must reconfigure via wizard to re-verify CalDAV credentials)
- Old `sync` key is removed from `settings_json` after migration
- Backwards compatible: if `sync_connections` is absent at runtime, treat as empty array

### One connection per provider per family
A family may not add the same provider twice. Attempting to add a second Apple connection replaces the first (with a confirmation prompt). This can be relaxed later when per-member connections are introduced.

---

## Backend Architecture

### New: `SyncConnectionService`
Replaces the existing `SyncService`. Responsibilities:
- CRUD for connections in `settings_json.sync_connections`
- CalDAV credential verification (step 2 of wizard)
- CalDAV calendar discovery (step 3 of wizard)
- Import run: fetch `VEVENT` objects from CalDAV, upsert as MentalLoad entries
- Export run: push new/updated MentalLoad entries back to the CalDAV calendar

### CalDAV library
Use `tsdav` (TypeScript CalDAV/CardDAV client). Avoids implementing raw PROPFIND/PUT/DELETE against the CalDAV spec by hand.

### Sync worker
Extend the existing background worker pattern (same as `reminder-worker.ts`):
- On startup: load all families' `sync_connections`
- For each connection where `isConnected = true`: schedule a recurring job at `syncIntervalMinutes`
- Each job calls `SyncConnectionService.run(connectionId)`
- Worker re-reads config on each tick (picks up interval changes)

### Conflict resolution
Last-write-wins by `updatedAt` timestamp. No manual merge UI in this scope.

### Provider adapter interface
Design the service with a provider adapter pattern so Google (OAuth) can slot in later without rewriting the core:
```ts
interface CalendarAdapter {
  verify(config: ConnectionConfig): Promise<boolean>;
  listCalendars(config: ConnectionConfig): Promise<RemoteCalendar[]>;
  importEvents(config: ConnectionConfig, since?: Date): Promise<RemoteEvent[]>;
  exportEvent(config: ConnectionConfig, event: Entry): Promise<void>;
  deleteEvent(config: ConnectionConfig, remoteId: string): Promise<void>;
}
```
`AppleCalDavAdapter` implements this. `GoogleOAuthAdapter` will implement it later.

---

## Advanced Settings (collapsible)

Visible under `▸ Advanced settings` on the connected card:
- CalDAV server URL (pre-filled `https://caldav.icloud.com/`, editable)
- Apple ID (read-only — change by reconfiguring)
- Calendar path (auto-discovered, editable)
- Sync interval: dropdown (15 min / 30 min / 1 hour / manual only)
- Last sync: timestamp + event count
- **Disconnect** button — removes the connection entry, does not delete already-imported events

---

## API Changes

New endpoints (under existing `/api/v1/sync/`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sync/connections` | List all connections for the family |
| POST | `/sync/connections` | Create and save a new connection (only called after verify succeeds) |
| PATCH | `/sync/connections/:id` | Update connection config (interval, direction toggles) |
| DELETE | `/sync/connections/:id` | Disconnect |
| POST | `/sync/connections/verify` | Test credentials without saving — wizard step 2 calls this first; only on success does the frontend proceed to step 3 |
| GET | `/sync/connections/calendars` | Discover remote calendars using verified-but-not-yet-saved credentials — wizard step 3 |
| POST | `/sync/connections/:id/run` | Manual sync now |

---

## Google Calendar — Architecture Readiness

The `CalendarAdapter` interface above is the extension point. When Google is implemented:
- Add `GoogleOAuthAdapter` implementing the same interface
- Add OAuth flow (separate from the wizard — OAuth requires a redirect, not a paste)
- The UI sidebar entry for Google shows a "coming soon" placeholder in this iteration, with a greyed-out Connect button

---

## Out-of-scope Notes

- The existing ICS invite-mail functionality is untouched by this change. It remains a separate mechanism.
- The old sync settings form is removed from the UI. The new sync page replaces it entirely.
- The `SyncService` class is deprecated and replaced by `SyncConnectionService`. Old sync API routes (`POST /sync/connect`, `POST /sync/run`) are kept alive during a transition period and internally delegate to the new service.
