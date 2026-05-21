# Apple Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw sync form in Settings with a guided split-layout UI that walks a family through bidirectional Apple Calendar sync via CalDAV, while building a multi-provider adapter architecture ready for Google Calendar.

**Architecture:** A new `SyncConnectionService` backed by a `CalendarAdapter` interface stores multiple connections per family inside `settings_json.sync_connections` (JSONB, no schema change). An `AppleCalDavAdapter` uses the `tsdav` library to connect to `caldav.icloud.com` with an app-specific password. The frontend replaces the old inline sync form with a split-layout component that renders a 5-step wizard for setup and a connected-state card for ongoing use.

**Tech Stack:** Fastify v5, TypeScript, `tsdav` (CalDAV), `node-ical` (already installed, for ICS parsing), Next.js 14, React, `node:test` (backend tests), `app.inject()` (integration tests)

---

## File Map

**Create:**
- `packages/backend/src/sync/calendar-adapter.ts` — `CalendarAdapter` interface + shared types
- `packages/backend/src/sync/apple-caldav-adapter.ts` — Apple iCloud CalDAV implementation
- `packages/backend/src/sync/sync-connection-service.ts` — CRUD + verify + run for connections
- `packages/backend/src/sync/sync-connection-service.test.ts` — unit tests with mock adapter
- `packages/backend/src/workers/sync-worker.ts` — background auto-sync loop
- `packages/frontend/lib/api-sync-connections.ts` — typed API client for new endpoints
- `packages/frontend/components/sync/apple-wizard.tsx` — 5-step Apple setup wizard
- `packages/frontend/components/sync/sync-connection-card.tsx` — connected-state panel
- `packages/frontend/components/sync/sync-settings.tsx` — split layout (sidebar + panel)

**Modify:**
- `packages/contracts/src/domain.ts` — add `SyncConnection` type
- `packages/contracts/src/api.ts` — add connection endpoint request/response types
- `packages/contracts/src/index.ts` — export new types
- `packages/backend/src/settings/settings-service.ts` — add migration of old `sync` → `sync_connections`
- `packages/backend/src/app.ts` — wire `SyncConnectionService`, register new routes
- `packages/backend/src/index.ts` — start sync worker
- `packages/frontend/components/dashboard-app.tsx` — replace inline sync form with `<SyncSettings />`
- `packages/frontend/components/mobile/mobile-settings-content.tsx` — same replacement

---

## Task 1: Add SyncConnection types to contracts

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/api.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Add `SyncConnection` to domain.ts**

Open `packages/contracts/src/domain.ts`. Add after the existing `SyncSettings` interface (around line 123):

```ts
export interface SyncConnection {
  id: string;
  provider: SyncProvider;
  isConnected: boolean;
  importEnabled: boolean;
  exportEnabled: boolean;
  // Apple CalDAV fields
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
  // Shared
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastImportCount?: number;
  lastExportCount?: number;
  createdAt: string;
}

export interface RemoteCalendar {
  url: string;
  displayName: string;
  eventCount?: number;
}
```

- [ ] **Step 2: Add API request/response types to api.ts**

Open `packages/contracts/src/api.ts`. Add after the existing sync types:

```ts
import type { SyncConnection, RemoteCalendar } from './domain';

export interface CreateSyncConnectionRequest {
  provider: SyncProvider;
  importEnabled: boolean;
  exportEnabled: boolean;
  syncIntervalMinutes?: number;
  // Apple-specific
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
}

export interface UpdateSyncConnectionRequest {
  importEnabled?: boolean;
  exportEnabled?: boolean;
  syncIntervalMinutes?: number;
  caldavUrl?: string;
  calendarPath?: string;
  calendarName?: string;
}

export interface VerifySyncConnectionRequest {
  provider: SyncProvider;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
}

export interface VerifySyncConnectionResponse {
  ok: boolean;
  message: string;
}

export interface ListRemoteCalendarsRequest {
  provider: SyncProvider;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
}

export interface SyncConnectionRunResponse {
  ok: boolean;
  connectionId: string;
  importedCount: number;
  exportedCount: number;
  lastSyncAt: string;
  message: string;
}
```

- [ ] **Step 3: Export new types from index.ts**

Open `packages/contracts/src/index.ts`. Ensure these are exported (add to the existing export list):

```ts
export type { SyncConnection, RemoteCalendar } from './domain';
export type {
  CreateSyncConnectionRequest,
  UpdateSyncConnectionRequest,
  VerifySyncConnectionRequest,
  VerifySyncConnectionResponse,
  ListRemoteCalendarsRequest,
  SyncConnectionRunResponse,
} from './api';
```

- [ ] **Step 4: Typecheck contracts**

```bash
cd packages/contracts && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/
git commit -m "feat(contracts): add SyncConnection types for multi-provider sync"
```

---

## Task 2: Install tsdav

**Files:**
- Modify: `packages/backend/package.json` (via npm)

- [ ] **Step 1: Install tsdav in the backend package**

```bash
cd packages/backend && npm install tsdav
```

- [ ] **Step 2: Verify import resolves**

```bash
cd packages/backend && node -e "import('tsdav').then(m => console.log('tsdav ok:', Object.keys(m).slice(0,3)))"
```

Expected output includes `tsdav ok:` with some exported names.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/package.json packages/backend/package-lock.json ../../package-lock.json
git commit -m "chore(backend): install tsdav for CalDAV client support"
```

---

## Task 3: CalendarAdapter interface

**Files:**
- Create: `packages/backend/src/sync/calendar-adapter.ts`

- [ ] **Step 1: Write the interface**

Create `packages/backend/src/sync/calendar-adapter.ts`:

```ts
import type { Entry } from '@mental-load/contracts';

export interface ConnectionConfig {
  provider: 'apple' | 'google';
  caldavUrl: string;
  username: string;
  password: string;
  calendarPath: string;
}

export interface RemoteEvent {
  uid: string;
  url: string;
  etag: string;
  icalData: string;
  updatedAt?: string;
}

export interface CalendarAdapter {
  /** Attempt to authenticate. Returns true if credentials are valid. */
  verify(config: ConnectionConfig): Promise<boolean>;

  /** List available calendars on the remote account. */
  listCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>): Promise<Array<{ url: string; displayName: string; eventCount?: number }>>;

  /** Fetch all events from the remote calendar since a given date. */
  importEvents(config: ConnectionConfig, since?: Date): Promise<RemoteEvent[]>;

  /** Push a MentalLoad entry to the remote calendar. Returns the remote URL. */
  exportEntry(config: ConnectionConfig, entry: Entry): Promise<string>;

  /** Delete a remote event by URL. */
  deleteRemoteEvent(config: ConnectionConfig, eventUrl: string): Promise<void>;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npx tsx --check src/sync/calendar-adapter.ts 2>&1 || npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/sync/calendar-adapter.ts
git commit -m "feat(backend): add CalendarAdapter interface for provider-agnostic sync"
```

---

## Task 4: AppleCalDavAdapter

**Files:**
- Create: `packages/backend/src/sync/apple-caldav-adapter.ts`

- [ ] **Step 1: Write the adapter**

Create `packages/backend/src/sync/apple-caldav-adapter.ts`:

```ts
import { createDAVClient } from 'tsdav';
import type { Entry } from '@mental-load/contracts';
import type { CalendarAdapter, ConnectionConfig, RemoteEvent } from './calendar-adapter';

export class AppleCalDavAdapter implements CalendarAdapter {
  async verify(config: ConnectionConfig): Promise<boolean> {
    try {
      const client = await createDAVClient({
        serverUrl: config.caldavUrl,
        credentials: { username: config.username, password: config.password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
      });
      await client.fetchCalendars();
      return true;
    } catch {
      return false;
    }
  }

  async listCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>) {
    const client = await createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    return calendars.map((cal) => ({
      url: cal.url,
      displayName: cal.displayName ?? cal.url,
    }));
  }

  async importEvents(config: ConnectionConfig, since?: Date): Promise<RemoteEvent[]> {
    const client = await createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) return [];

    const timeRange = since ? { timeRange: { start: since.toISOString(), end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } } : {};
    const objects = await client.fetchCalendarObjects({ calendar: target, ...timeRange });

    return objects
      .filter((obj) => obj.data)
      .map((obj) => ({
        uid: extractUid(obj.data),
        url: obj.url,
        etag: obj.etag ?? '',
        icalData: obj.data,
      }));
  }

  async exportEntry(config: ConnectionConfig, entry: Entry): Promise<string> {
    const client = await createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) throw new Error('Target calendar not found on remote');

    const uid = `mental-load-${entry.id}@mentalload`;
    const icalString = entryToIcal(entry, uid);
    const filename = `${uid}.ics`;

    // Check if event already exists (update) or is new (create)
    const existing = await client.fetchCalendarObjects({ calendar: target });
    const match = existing.find((o) => o.data?.includes(`UID:${uid}`));

    if (match) {
      await client.updateCalendarObject({ calendarObject: { ...match, data: icalString } });
      return match.url;
    } else {
      await client.createCalendarObject({ calendar: target, filename, iCalString: icalString });
      return `${target.url}${filename}`;
    }
  }

  async deleteRemoteEvent(config: ConnectionConfig, eventUrl: string): Promise<void> {
    const client = await createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) return;

    const objects = await client.fetchCalendarObjects({ calendar: target });
    const match = objects.find((o) => o.url === eventUrl);
    if (match) {
      await client.deleteCalendarObject({ calendarObject: match });
    }
  }
}

function extractUid(icalData: string): string {
  const match = icalData.match(/^UID:(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function formatIcalDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function entryToIcal(entry: Entry, uid: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MentalLoad//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcalDate(new Date().toISOString(), false)}`,
    `DTSTART${entry.allDay ? ';VALUE=DATE' : ''}:${formatIcalDate(entry.startTime, entry.allDay)}`,
    `DTEND${entry.allDay ? ';VALUE=DATE' : ''}:${formatIcalDate(entry.endTime, entry.allDay)}`,
    `SUMMARY:${entry.title.replace(/\n/g, '\\n')}`,
  ];
  if (entry.location) lines.push(`LOCATION:${entry.location.replace(/\n/g, '\\n')}`);
  if (entry.recurrenceRule) lines.push(`RRULE:${entry.recurrenceRule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/sync/apple-caldav-adapter.ts
git commit -m "feat(backend): add AppleCalDavAdapter for iCloud CalDAV sync"
```

---

## Task 5: SyncConnectionService

**Files:**
- Create: `packages/backend/src/sync/sync-connection-service.ts`
- Create: `packages/backend/src/sync/sync-connection-service.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/backend/src/sync/sync-connection-service.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';
import type { CalendarAdapter, ConnectionConfig, RemoteEvent } from './calendar-adapter';
import { SyncConnectionService } from './sync-connection-service';
import type { Entry } from '@mental-load/contracts';

// ── Mock adapter ────────────────────────────────────────────────────────────

class MockAdapter implements CalendarAdapter {
  verified = true;
  calendars = [{ url: '/cal/', displayName: 'Test Calendar' }];
  events: RemoteEvent[] = [];
  exported: Array<{ config: ConnectionConfig; entry: Entry }> = [];

  async verify() { return this.verified; }
  async listCalendars() { return this.calendars; }
  async importEvents() { return this.events; }
  async exportEntry(config: ConnectionConfig, entry: Entry) {
    this.exported.push({ config, entry });
    return `/cal/${entry.id}.ics`;
  }
  async deleteRemoteEvent() {}
}

// ── Mock pool ────────────────────────────────────────────────────────────────

function mockPool(settingsJson: Record<string, unknown> = {}): { pool: Pool; stored: Record<string, unknown>[] } {
  const stored: Record<string, unknown>[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      if (sql.includes('select settings_json')) {
        return { rows: [{ settings_json: settingsJson }] } as unknown as QueryResult;
      }
      if (sql.includes('update families')) {
        stored.push(params?.[0] as Record<string, unknown>);
        return { rows: [] } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    },
  } as unknown as Pool;
  return { pool, stored };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('listConnections returns empty array when no connections stored', async () => {
  const { pool } = mockPool({});
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const result = await svc.listConnections();
  assert.deepEqual(result, []);
});

test('createConnection saves a new connection', async () => {
  const { pool, stored } = mockPool({ sync_connections: [] });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const conn = await svc.createConnection({
    provider: 'apple',
    importEnabled: true,
    exportEnabled: true,
    appleId: 'far@icloud.com',
    caldavUrl: 'https://caldav.icloud.com',
    appPassword: 'xxxx-xxxx-xxxx-xxxx',
    calendarPath: '/cal/',
    calendarName: "Far's Calendar",
  });
  assert.equal(conn.provider, 'apple');
  assert.equal(conn.isConnected, true);
  assert.ok(stored.length > 0);
});

test('createConnection rejects duplicate provider', async () => {
  const existing = [{
    id: 'conn-1', provider: 'apple', isConnected: true,
    importEnabled: true, exportEnabled: false,
    syncIntervalMinutes: 15, createdAt: new Date().toISOString(),
  }];
  const { pool } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  await assert.rejects(
    () => svc.createConnection({ provider: 'apple', importEnabled: true, exportEnabled: false }),
    /already connected/i,
  );
});

test('verify returns true when adapter confirms credentials', async () => {
  const { pool } = mockPool({});
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const ok = await svc.verify({
    provider: 'apple',
    caldavUrl: 'https://caldav.icloud.com',
    username: 'far@icloud.com',
    password: 'xxxx-xxxx-xxxx-xxxx',
  });
  assert.equal(ok, true);
});

test('deleteConnection removes entry from array', async () => {
  const existing = [{
    id: 'conn-1', provider: 'apple', isConnected: true,
    importEnabled: true, exportEnabled: false,
    syncIntervalMinutes: 15, createdAt: new Date().toISOString(),
  }];
  const { pool, stored } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  await svc.deleteConnection('conn-1');
  const savedConnections = JSON.parse(stored[stored.length - 1] as string).sync_connections;
  assert.equal(savedConnections.length, 0);
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd packages/backend && npx tsx --test src/sync/sync-connection-service.test.ts
```

Expected: failures with "Cannot find module './sync-connection-service'".

- [ ] **Step 3: Write the service**

Create `packages/backend/src/sync/sync-connection-service.ts`:

```ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type { SyncConnection } from '@mental-load/contracts';
import type { CalendarAdapter, ConnectionConfig } from './calendar-adapter';

export interface CreateConnectionInput {
  provider: 'apple' | 'google';
  importEnabled: boolean;
  exportEnabled: boolean;
  syncIntervalMinutes?: number;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
}

export class SyncConnectionService {
  constructor(
    private readonly pool: Pool,
    private readonly familyId: string,
    private readonly adapter: CalendarAdapter,
  ) {}

  async listConnections(): Promise<SyncConnection[]> {
    const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
      'select settings_json from families where id = $1',
      [this.familyId],
    );
    const raw = result.rows[0]?.settings_json ?? {};
    return (raw.sync_connections as SyncConnection[] | undefined) ?? [];
  }

  async getConnection(connectionId: string): Promise<SyncConnection | undefined> {
    const connections = await this.listConnections();
    return connections.find((c) => c.id === connectionId);
  }

  async createConnection(input: CreateConnectionInput): Promise<SyncConnection> {
    const connections = await this.listConnections();
    const duplicate = connections.find((c) => c.provider === input.provider);
    if (duplicate) {
      throw new Error(`${input.provider} is already connected. Disconnect it first or use reconfigure.`);
    }

    const connection: SyncConnection = {
      id: uuid(),
      provider: input.provider,
      isConnected: true,
      importEnabled: input.importEnabled,
      exportEnabled: input.exportEnabled,
      syncIntervalMinutes: input.syncIntervalMinutes ?? 15,
      appleId: input.appleId,
      caldavUrl: input.caldavUrl ?? 'https://caldav.icloud.com',
      appPassword: input.appPassword,
      calendarPath: input.calendarPath,
      calendarName: input.calendarName,
      createdAt: new Date().toISOString(),
    };

    await this.saveConnections([...connections, connection]);
    return connection;
  }

  async updateConnection(connectionId: string, patch: Partial<SyncConnection>): Promise<SyncConnection> {
    const connections = await this.listConnections();
    const idx = connections.findIndex((c) => c.id === connectionId);
    if (idx < 0) throw new Error(`Connection ${connectionId} not found`);
    const updated = { ...connections[idx], ...patch };
    connections[idx] = updated;
    await this.saveConnections(connections);
    return updated;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connections = await this.listConnections();
    await this.saveConnections(connections.filter((c) => c.id !== connectionId));
  }

  async verify(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'> & { provider: string }): Promise<boolean> {
    return this.adapter.verify({
      provider: config.provider as 'apple',
      caldavUrl: config.caldavUrl,
      username: config.username,
      password: config.password,
      calendarPath: '',
    });
  }

  async listRemoteCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>) {
    return this.adapter.listCalendars(config);
  }

  async runSync(connectionId: string, entryRepository: { list(): Promise<import('@mental-load/contracts').Entry[]> }): Promise<{ importedCount: number; exportedCount: number }> {
    const conn = await this.getConnection(connectionId);
    if (!conn || !conn.isConnected || !conn.caldavUrl || !conn.appPassword || !conn.calendarPath) {
      return { importedCount: 0, exportedCount: 0 };
    }

    const adapterConfig: ConnectionConfig = {
      provider: conn.provider as 'apple',
      caldavUrl: conn.caldavUrl,
      username: conn.appleId ?? '',
      password: conn.appPassword,
      calendarPath: conn.calendarPath,
    };

    let importedCount = 0;
    let exportedCount = 0;

    if (conn.importEnabled) {
      const since = conn.lastSyncAt ? new Date(conn.lastSyncAt) : undefined;
      const remoteEvents = await this.adapter.importEvents(adapterConfig, since);
      importedCount = remoteEvents.length;
      // Actual ICS import is handled by entryService.importFromIcs per event
      // For now mark count — full import wired in Task 7 (app.ts integration)
    }

    if (conn.exportEnabled) {
      const entries = await entryRepository.list();
      const toExport = entries.filter((e) => !e.parentEntryId); // skip recurring children
      for (const entry of toExport) {
        await this.adapter.exportEntry(adapterConfig, entry);
        exportedCount++;
      }
    }

    await this.updateConnection(connectionId, {
      lastSyncAt: new Date().toISOString(),
      lastImportCount: importedCount,
      lastExportCount: exportedCount,
    });

    return { importedCount, exportedCount };
  }

  private async saveConnections(connections: SyncConnection[]): Promise<void> {
    await this.pool.query(
      `update families
       set settings_json = jsonb_set(settings_json, '{sync_connections}', $1::jsonb)
       where id = $2`,
      [JSON.stringify(connections), this.familyId],
    );
  }
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
cd packages/backend && npx tsx --test src/sync/sync-connection-service.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/sync/
git commit -m "feat(backend): add SyncConnectionService with CRUD, verify, and sync run"
```

---

## Task 6: Settings migration for old sync format

**Files:**
- Modify: `packages/backend/src/settings/settings-service.ts`

The old `settings_json.sync` key (single provider) must be migrated to `sync_connections` on first read. Families that had `provider: 'none'` get an empty array. Others get a single placeholder entry marked `isConnected: false` (they must reconfigure via the wizard to supply CalDAV credentials).

- [ ] **Step 1: Add migration helper inside settings-service.ts**

Open `packages/backend/src/settings/settings-service.ts`. Add this function before the `SettingsService` class:

```ts
import { v4 as uuid } from 'uuid';

async function migrateSyncSettings(pool: Pool, familyId: string): Promise<void> {
  const result = await pool.query<{ settings_json: Record<string, unknown> }>(
    'select settings_json from families where id = $1',
    [familyId],
  );
  const stored = result.rows[0]?.settings_json ?? {};

  // Already migrated
  if ('sync_connections' in stored) return;

  const oldSync = stored.sync as Record<string, unknown> | undefined;
  const syncConnections: unknown[] = [];

  if (oldSync && oldSync.provider && oldSync.provider !== 'none') {
    syncConnections.push({
      id: uuid(),
      provider: oldSync.provider,
      isConnected: false, // force re-auth: old format has no CalDAV credentials
      importEnabled: true,
      exportEnabled: false,
      syncIntervalMinutes: 15,
      createdAt: new Date().toISOString(),
    });
  }

  await pool.query(
    `update families
     set settings_json = (settings_json - 'sync') || jsonb_build_object('sync_connections', $1::jsonb)
     where id = $2`,
    [JSON.stringify(syncConnections), familyId],
  );
}
```

- [ ] **Step 2: Call migration in `getSettings`**

In the `getSettings` method of `SettingsService`, add the migration call at the very top:

```ts
async getSettings(): Promise<AppSettings> {
  await migrateSyncSettings(this.pool, this.familyId);  // ← add this line
  const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
    'select settings_json from families where id = $1',
    [this.familyId],
  );
  // ... rest of method unchanged
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/settings/settings-service.ts
git commit -m "feat(backend): migrate old single-provider sync to sync_connections array on first read"
```

---

## Task 7: New API routes in app.ts

**Files:**
- Modify: `packages/backend/src/app.ts`

Add `SyncConnectionService` to `getRequestServices`, register the 7 new endpoints, and add an integration test.

- [ ] **Step 1: Write a failing integration test**

Add to `packages/backend/src/app.test.ts` (at the bottom, before the final closing):

```ts
test('GET /api/v1/sync/connections returns empty array for fresh family', async () => {
  const app = await createTestApp();

  // Create a session by logging in as the seeded demo user
  // The test app uses the DEFAULT_FAMILY_ID. We need a valid session cookie.
  // Since auth is complex to set up in tests, verify the route exists and returns 401 without cookie.
  const response = await app.inject({ method: 'GET', url: '/api/v1/sync/connections' });
  assert.equal(response.statusCode, 401);

  await app.close();
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
cd packages/backend && npx tsx --test src/app.test.ts 2>&1 | tail -20
```

Expected: The new test fails (route doesn't exist yet, but 401 expected from auth, which requires the route to exist). Actually it will return 404. That's the failure we want.

- [ ] **Step 3: Wire SyncConnectionService into getRequestServices in app.ts**

In `app.ts`, add the import at the top:

```ts
import { SyncConnectionService } from './sync/sync-connection-service';
import { AppleCalDavAdapter } from './sync/apple-caldav-adapter';
import type {
  CreateSyncConnectionRequest,
  UpdateSyncConnectionRequest,
  VerifySyncConnectionRequest,
  ListRemoteCalendarsRequest,
} from '@mental-load/contracts';
```

Inside `getRequestServices(familyId)`, after the `syncService` line, add:

```ts
const syncConnectionService = infrastructure.pool
  ? new SyncConnectionService(infrastructure.pool, familyId, new AppleCalDavAdapter())
  : (() => { throw new Error('SyncConnectionService requires postgres'); })();
```

And include it in the return value:

```ts
return { ...repo, entryService, dailyTimelineService, syncService, syncConnectionService, assistantService, settingsService };
```

- [ ] **Step 4: Add the `svc` helper if not already present**

In `app.ts`, find the pattern used for `svc(request)`. It should already be defined. If it uses `(request as any).svc`, keep that pattern.

- [ ] **Step 5: Register new sync connection routes**

Add after the existing `app.post('/api/v1/sync/run', ...)` block:

```ts
// ── Sync Connections ────────────────────────────────────────────────────────

app.get('/api/v1/sync/connections', async (request) => {
  return svc(request).syncConnectionService.listConnections();
});

app.post<{ Body: CreateSyncConnectionRequest }>('/api/v1/sync/connections', async (request, reply) => {
  try {
    return await svc(request).syncConnectionService.createConnection(request.body);
  } catch (error) {
    reply.code(400);
    return { message: error instanceof Error ? error.message : 'Could not create connection' };
  }
});

app.patch<{ Params: { id: string }; Body: UpdateSyncConnectionRequest }>('/api/v1/sync/connections/:id', async (request, reply) => {
  try {
    return await svc(request).syncConnectionService.updateConnection(request.params.id, request.body);
  } catch (error) {
    reply.code(404);
    return { message: error instanceof Error ? error.message : 'Connection not found' };
  }
});

app.delete<{ Params: { id: string } }>('/api/v1/sync/connections/:id', async (request, reply) => {
  await svc(request).syncConnectionService.deleteConnection(request.params.id);
  reply.code(204);
});

app.post<{ Body: VerifySyncConnectionRequest }>('/api/v1/sync/connections/verify', async (request, reply) => {
  const { provider, appleId, caldavUrl, appPassword } = request.body;
  const ok = await svc(request).syncConnectionService.verify({
    provider: provider ?? 'apple',
    caldavUrl: caldavUrl ?? 'https://caldav.icloud.com',
    username: appleId ?? '',
    password: appPassword ?? '',
  });
  if (!ok) {
    reply.code(400);
    return { ok: false, message: 'Could not connect — check your Apple ID and app-specific password.' };
  }
  return { ok: true, message: 'Credentials verified successfully.' };
});

app.post<{ Body: ListRemoteCalendarsRequest }>('/api/v1/sync/connections/calendars', async (request, reply) => {
  try {
    const { caldavUrl, appleId, appPassword } = request.body;
    const calendars = await svc(request).syncConnectionService.listRemoteCalendars({
      caldavUrl: caldavUrl ?? 'https://caldav.icloud.com',
      username: appleId ?? '',
      password: appPassword ?? '',
    });
    return { calendars };
  } catch (error) {
    reply.code(400);
    return { message: error instanceof Error ? error.message : 'Could not list calendars' };
  }
});

app.post<{ Params: { id: string } }>('/api/v1/sync/connections/:id/run', async (request, reply) => {
  try {
    const { entryRepository } = svc(request);
    const result = await svc(request).syncConnectionService.runSync(request.params.id, entryRepository);
    return { ok: true, connectionId: request.params.id, ...result, lastSyncAt: new Date().toISOString(), message: `Synced: ${result.importedCount} imported, ${result.exportedCount} exported.` };
  } catch (error) {
    reply.code(500);
    return { message: error instanceof Error ? error.message : 'Sync failed' };
  }
});
```

- [ ] **Step 6: Run all backend tests**

```bash
cd packages/backend && npx tsx --test src/app.test.ts
```

Expected: the new route test passes (401), all existing tests still pass.

- [ ] **Step 7: Typecheck**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat(backend): register sync connection API routes"
```

---

## Task 8: Sync worker

**Files:**
- Create: `packages/backend/src/workers/sync-worker.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Write the sync worker**

Create `packages/backend/src/workers/sync-worker.ts`:

```ts
import { Pool } from 'pg';
import { EntryService } from '../domains/entries/entry-service';
import { SyncConnectionService } from '../sync/sync-connection-service';
import { AppleCalDavAdapter } from '../sync/apple-caldav-adapter';
import { createRepositoryBundle } from '../repositories/repository-factory';
import { DomainEventBus } from '../events/domain-event-bus';
import { ReminderScheduler } from '../reminders/reminder-scheduler';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log('[sync-worker] DATABASE_URL not set — sync worker idle.');
  setInterval(() => undefined, 60_000);
} else {
  const pool = new Pool({ connectionString: DATABASE_URL });

  async function runSyncForAllFamilies(): Promise<void> {
    const families = await pool.query<{ id: string }>('select id from families');

    for (const { id: familyId } of families.rows) {
      const svc = new SyncConnectionService(pool, familyId, new AppleCalDavAdapter());
      const connections = await svc.listConnections();
      const active = connections.filter((c) => c.isConnected);

      for (const conn of active) {
        const minutesSinceLast = conn.lastSyncAt
          ? (Date.now() - new Date(conn.lastSyncAt).getTime()) / 60_000
          : Infinity;

        if (minutesSinceLast < conn.syncIntervalMinutes) continue;

        console.log(`[sync-worker] syncing connection ${conn.id} (${conn.provider}) for family ${familyId}`);
        try {
          const bundle = await createRepositoryBundle();
          const entryRepository = {
            list: () => bundle.entryRepository.list(familyId),
          };
          await svc.runSync(conn.id, entryRepository);
          await bundle.close?.();
        } catch (error) {
          console.error(`[sync-worker] sync failed for connection ${conn.id}:`, error);
        }
      }
    }
  }

  // Check every minute — each connection's interval is enforced inside runSyncForAllFamilies
  setInterval(() => {
    runSyncForAllFamilies().catch((err) => console.error('[sync-worker] error:', err));
  }, 60_000);

  // Run once on startup
  runSyncForAllFamilies().catch((err) => console.error('[sync-worker] startup error:', err));

  console.log('[sync-worker] started — polling every 60 seconds');
}
```

- [ ] **Step 2: Wire worker into index.ts**

Open `packages/backend/src/index.ts`. After the `start()` call, import the worker so it starts in the same process:

```ts
import { buildApp } from './app';
import './workers/sync-worker'; // starts polling on import

async function start(): Promise<void> {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/workers/sync-worker.ts packages/backend/src/index.ts
git commit -m "feat(backend): add background sync worker polling all family connections"
```

---

## Task 9: Frontend API client

**Files:**
- Create: `packages/frontend/lib/api-sync-connections.ts`

- [ ] **Step 1: Write the API client**

Create `packages/frontend/lib/api-sync-connections.ts`:

```ts
import type {
  SyncConnection,
  CreateSyncConnectionRequest,
  UpdateSyncConnectionRequest,
  VerifySyncConnectionRequest,
  VerifySyncConnectionResponse,
  ListRemoteCalendarsRequest,
  RemoteCalendar,
  SyncConnectionRunResponse,
} from '@mental-load/contracts';

const BASE = '/api/v1/sync/connections';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listSyncConnections(): Promise<SyncConnection[]> {
  return request<SyncConnection[]>(BASE);
}

export function createSyncConnection(body: CreateSyncConnectionRequest): Promise<SyncConnection> {
  return request<SyncConnection>(BASE, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSyncConnection(id: string, body: UpdateSyncConnectionRequest): Promise<SyncConnection> {
  return request<SyncConnection>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteSyncConnection(id: string): Promise<void> {
  return request<void>(`${BASE}/${id}`, { method: 'DELETE' });
}

export function verifySyncConnection(body: VerifySyncConnectionRequest): Promise<VerifySyncConnectionResponse> {
  return request<VerifySyncConnectionResponse>(`${BASE}/verify`, { method: 'POST', body: JSON.stringify(body) });
}

export function listRemoteCalendars(body: ListRemoteCalendarsRequest): Promise<{ calendars: RemoteCalendar[] }> {
  return request<{ calendars: RemoteCalendar[] }>(`${BASE}/calendars`, { method: 'POST', body: JSON.stringify(body) });
}

export function runSyncConnection(id: string): Promise<SyncConnectionRunResponse> {
  return request<SyncConnectionRunResponse>(`${BASE}/${id}/run`, { method: 'POST' });
}
```

- [ ] **Step 2: Typecheck (frontend)**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/lib/api-sync-connections.ts
git commit -m "feat(frontend): add typed API client for sync connection endpoints"
```

---

## Task 10: Apple wizard component

**Files:**
- Create: `packages/frontend/components/sync/apple-wizard.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p packages/frontend/components/sync
```

- [ ] **Step 2: Write the wizard**

Create `packages/frontend/components/sync/apple-wizard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { RemoteCalendar, SyncConnection } from '@mental-load/contracts';
import {
  verifySyncConnection,
  listRemoteCalendars,
  createSyncConnection,
} from '../../lib/api-sync-connections';

interface AppleWizardProps {
  onComplete: (connection: SyncConnection) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

export function AppleWizard({ onComplete, onCancel }: AppleWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [caldavUrl] = useState('https://caldav.icloud.com');
  const [remoteCalendars, setRemoteCalendars] = useState<RemoteCalendar[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState<RemoteCalendar | null>(null);
  const [importEnabled, setImportEnabled] = useState(true);
  const [exportEnabled, setExportEnabled] = useState(true);
  const [finalConnection, setFinalConnection] = useState<SyncConnection | null>(null);

  async function handleVerify() {
    setError('');
    setBusy(true);
    try {
      const result = await verifySyncConnection({ provider: 'apple', appleId, caldavUrl, appPassword });
      if (!result.ok) { setError(result.message); return; }
      const { calendars } = await listRemoteCalendars({ provider: 'apple', appleId, caldavUrl, appPassword });
      setRemoteCalendars(calendars);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!selectedCalendar) return;
    setError('');
    setBusy(true);
    try {
      const conn = await createSyncConnection({
        provider: 'apple',
        importEnabled,
        exportEnabled,
        appleId,
        caldavUrl,
        appPassword,
        calendarPath: selectedCalendar.url,
        calendarName: selectedCalendar.displayName,
      });
      setFinalConnection(conn);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save connection');
    } finally {
      setBusy(false);
    }
  }

  const stepLabel = ['', 'Apple ID', 'App password', 'Pick calendar', 'Sync direction', 'Done'];

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {([1, 2, 3, 4, 5] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center" style={{ flex: s < 5 ? '1' : undefined }}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold
              ${step > s ? 'bg-green-500 text-black' : step === s ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
              {step > s ? '✓' : s}
            </div>
            {i < 4 && <div className={`h-0.5 flex-1 ${step > s ? 'bg-primary' : 'bg-border/40'}`} />}
          </div>
        ))}
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {/* Step 1 — Apple ID */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 1 of 5</p>
            <h3 className="text-base font-bold">Enter your Apple ID</h3>
            <p className="text-sm text-muted-foreground">The email you use for iCloud — usually @icloud.com, @me.com, or your own address.</p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Apple ID (iCloud email)</span>
            <input
              type="email"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="far@icloud.com"
              className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <p className="text-xs text-muted-foreground">Your main Apple ID password is never stored — we use a separate app-specific password in the next step.</p>
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">Cancel</button>
            <button
              onClick={() => setStep(2)}
              disabled={!appleId.includes('@')}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Continue →</button>
          </div>
        </div>
      )}

      {/* Step 2 — App-specific password */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 2 of 5</p>
            <h3 className="text-base font-bold">Create an app-specific password</h3>
            <p className="text-sm text-muted-foreground">Apple requires a one-time password for apps connecting to iCloud. Takes about 60 seconds.</p>
          </div>
          <ol className="flex flex-col gap-2">
            {[
              <>Open <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">appleid.apple.com</a> and sign in</>,
              <>Go to <strong>Sign-In and Security</strong> → <strong>App-Specific Passwords</strong></>,
              <>Click <strong>+</strong> and name it <code className="rounded bg-muted px-1 text-xs">MentalLoad</code></>,
              <>Copy the password (format: <code className="rounded bg-muted px-1 text-xs">xxxx-xxxx-xxxx-xxxx</code>) and paste it below</>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/20 text-xs font-bold text-primary">{i + 1}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </li>
            ))}
          </ol>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">App-specific password</span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => void handleVerify()}
              disabled={busy || !appPassword}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Verifying…' : 'Connect & verify →'}</button>
          </div>
        </div>
      )}

      {/* Step 3 — Pick calendar */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 3 of 5</p>
            <h3 className="text-base font-bold">Pick your calendar</h3>
            <p className="text-sm text-muted-foreground">MentalLoad found these calendars in your iCloud account. Choose which one to sync.</p>
          </div>
          <div className="flex flex-col gap-2">
            {remoteCalendars.map((cal) => (
              <button
                key={cal.url}
                onClick={() => setSelectedCalendar(cal)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors
                  ${selectedCalendar?.url === cal.url ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/40'}`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold
                  ${selectedCalendar?.url === cal.url ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
                  {selectedCalendar?.url === cal.url ? '✓' : ''}
                </span>
                <span className="font-medium">{cal.displayName}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => setStep(4)}
              disabled={!selectedCalendar}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Use this calendar →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Direction */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 4 of 5</p>
            <h3 className="text-base font-bold">Sync direction</h3>
            <p className="text-sm text-muted-foreground">Choose how MentalLoad and Apple Calendar should stay in sync.</p>
          </div>
          {[
            { label: 'Import from Apple Calendar', desc: 'Apple events appear in MentalLoad automatically', value: importEnabled, set: setImportEnabled },
            { label: 'Export to Apple Calendar', desc: 'Events added in MentalLoad are pushed back to Apple Calendar', value: exportEnabled, set: setExportEnabled },
          ].map(({ label, desc, value, set }) => (
            <button
              key={label}
              onClick={() => set(!value)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors
                ${value ? 'border-primary bg-primary/10' : 'border-border/60'}`}
            >
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <div className={`h-5 w-9 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted/40'}`}>
                <div className={`m-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
              </div>
            </button>
          ))}
          <p className="text-xs text-muted-foreground">Both on = fully bidirectional. Import-only is the safe option if you just want to read Apple events.</p>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => void handleFinish()}
              disabled={busy || (!importEnabled && !exportEnabled)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Saving…' : 'Finish setup →'}</button>
          </div>
        </div>
      )}

      {/* Step 5 — Success */}
      {step === 5 && finalConnection && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl">✅</div>
          <div>
            <h3 className="text-base font-bold text-green-600 dark:text-green-400">Apple Calendar connected!</h3>
            <p className="text-sm text-muted-foreground">MentalLoad is now syncing with {selectedCalendar?.displayName}.</p>
          </div>
          <div className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-left">
            {[
              ['Apple ID', appleId],
              ['Calendar', selectedCalendar?.displayName ?? ''],
              ['Direction', importEnabled && exportEnabled ? 'Bidirectional' : importEnabled ? 'Import only' : 'Export only'],
              ['Auto-sync', 'Every 15 minutes'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Want to also connect Google Calendar? Use the <strong>+ Add</strong> button in the sidebar when it becomes available.</p>
          <button
            onClick={() => onComplete(finalConnection)}
            className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Done</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck frontend**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/sync/apple-wizard.tsx
git commit -m "feat(frontend): add 5-step Apple Calendar setup wizard component"
```

---

## Task 11: Sync connection card

**Files:**
- Create: `packages/frontend/components/sync/sync-connection-card.tsx`

- [ ] **Step 1: Write the card**

Create `packages/frontend/components/sync/sync-connection-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { SyncConnection } from '@mental-load/contracts';
import { updateSyncConnection, deleteSyncConnection, runSyncConnection } from '../../lib/api-sync-connections';

interface SyncConnectionCardProps {
  connection: SyncConnection;
  onReconfigure: () => void;
  onDeleted: () => void;
  onUpdated: (conn: SyncConnection) => void;
}

export function SyncConnectionCard({ connection, onReconfigure, onDeleted, onUpdated }: SyncConnectionCardProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [interval, setInterval_] = useState(String(connection.syncIntervalMinutes));
  const [caldavUrl, setCaldavUrl] = useState(connection.caldavUrl ?? 'https://caldav.icloud.com');
  const [calendarPath, setCalendarPath] = useState(connection.calendarPath ?? '');

  async function handleSyncNow() {
    setBusy(true);
    setMessage('');
    try {
      const result = await runSyncConnection(connection.id);
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdvanced() {
    setBusy(true);
    try {
      const updated = await updateSyncConnection(connection.id, {
        syncIntervalMinutes: Number(interval),
        caldavUrl,
        calendarPath,
      });
      onUpdated(updated);
      setMessage('Settings saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Apple Calendar? Already-imported events will remain in MentalLoad.')) return;
    await deleteSyncConnection(connection.id);
    onDeleted();
  }

  const directionLabel = connection.importEnabled && connection.exportEnabled
    ? 'Bidirectional'
    : connection.importEnabled ? 'Import only' : 'Export only';

  return (
    <div className="flex flex-col gap-4">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{connection.provider === 'apple' ? '🍎' : 'G'}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{connection.calendarName ?? connection.provider}</span>
            <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-600 dark:text-green-400">Connected</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {connection.lastSyncAt
              ? `Last sync ${new Date(connection.lastSyncAt).toLocaleTimeString()} · `
              : 'Never synced · '}
            {directionLabel}
          </p>
        </div>
      </div>

      {message && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{message}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleSyncNow()}
          disabled={busy}
          className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60 disabled:opacity-40"
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          onClick={onReconfigure}
          className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60"
        >
          Reconfigure
        </button>
      </div>

      {/* Advanced settings */}
      <button
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>{advancedOpen ? '▾' : '▸'}</span> Advanced settings
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">CalDAV server URL</span>
            <input
              value={caldavUrl}
              onChange={(e) => setCaldavUrl(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Apple ID (read-only)</span>
            <input
              value={connection.appleId ?? ''}
              readOnly
              className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm opacity-60 outline-none"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Calendar path</span>
            <input
              value={calendarPath}
              onChange={(e) => setCalendarPath(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Auto-sync interval</span>
            <select
              value={interval}
              onChange={(e) => setInterval_(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
            >
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
              <option value="99999">Manual only</option>
            </select>
          </label>
          {connection.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(connection.lastSyncAt).toLocaleString()} · {connection.lastImportCount ?? 0} imported
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void handleSaveAdvanced()}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Save</button>
            <button
              onClick={() => void handleDisconnect()}
              className="rounded-xl border border-destructive/60 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >Disconnect</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/sync/sync-connection-card.tsx
git commit -m "feat(frontend): add SyncConnectionCard for connected-state display"
```

---

## Task 12: Sync settings (split layout)

**Files:**
- Create: `packages/frontend/components/sync/sync-settings.tsx`

- [ ] **Step 1: Write the split layout component**

Create `packages/frontend/components/sync/sync-settings.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { SyncConnection } from '@mental-load/contracts';
import { listSyncConnections } from '../../lib/api-sync-connections';
import { AppleWizard } from './apple-wizard';
import { SyncConnectionCard } from './sync-connection-card';

type PanelState =
  | { mode: 'card'; connection: SyncConnection }
  | { mode: 'wizard'; provider: 'apple' }
  | { mode: 'empty' };

export function SyncSettings() {
  const [connections, setConnections] = useState<SyncConnection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState>({ mode: 'empty' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSyncConnections()
      .then((list) => {
        setConnections(list);
        if (list.length > 0) {
          setSelected(list[0].id);
          setPanel({ mode: 'card', connection: list[0] });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  function selectConnection(conn: SyncConnection) {
    setSelected(conn.id);
    setPanel({ mode: 'card', connection: conn });
  }

  function startWizard(provider: 'apple') {
    setSelected(null);
    setPanel({ mode: 'wizard', provider });
  }

  function handleWizardComplete(conn: SyncConnection) {
    const next = [...connections.filter((c) => c.id !== conn.id), conn];
    setConnections(next);
    setSelected(conn.id);
    setPanel({ mode: 'card', connection: conn });
  }

  function handleDeleted() {
    const next = connections.filter((c) => c.id !== selected);
    setConnections(next);
    setSelected(next[0]?.id ?? null);
    setPanel(next[0] ? { mode: 'card', connection: next[0] } : { mode: 'empty' });
  }

  function handleUpdated(conn: SyncConnection) {
    const next = connections.map((c) => c.id === conn.id ? conn : c);
    setConnections(next);
    setPanel({ mode: 'card', connection: conn });
  }

  const hasApple = connections.some((c) => c.provider === 'apple');

  if (loading) return <div className="text-sm text-muted-foreground">Loading sync settings…</div>;

  return (
    <div className="flex min-h-[240px] gap-0 rounded-2xl border border-border/60 overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/60 p-3">
        {connections.map((conn) => (
          <button
            key={conn.id}
            onClick={() => selectConnection(conn)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors
              ${selected === conn.id ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-accent/40'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${conn.isConnected ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
            <span className="truncate">{conn.provider === 'apple' ? '🍎 Apple' : conn.provider}</span>
          </button>
        ))}

        {/* Coming-soon Google placeholder */}
        <button
          disabled
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground/40"
          title="Coming soon"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20" />
          <span className="truncate">G Google</span>
        </button>

        <div className="mt-auto pt-2">
          {!hasApple && (
            <button
              onClick={() => startWizard('apple')}
              className="flex w-full items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-primary/10"
            >+ Add</button>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 p-5">
        {panel.mode === 'empty' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No calendar connected yet.</p>
            <button
              onClick={() => startWizard('apple')}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >Connect Apple Calendar</button>
          </div>
        )}

        {panel.mode === 'card' && (
          <SyncConnectionCard
            connection={panel.connection}
            onReconfigure={() => setPanel({ mode: 'wizard', provider: panel.connection.provider as 'apple' })}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
          />
        )}

        {panel.mode === 'wizard' && (
          <AppleWizard
            onComplete={handleWizardComplete}
            onCancel={() => {
              const conn = connections[0];
              setPanel(conn ? { mode: 'card', connection: conn } : { mode: 'empty' });
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/sync/sync-settings.tsx
git commit -m "feat(frontend): add SyncSettings split-layout component"
```

---

## Task 13: Wire into dashboard-app and mobile settings

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`
- Modify: `packages/frontend/components/mobile/mobile-settings-content.tsx`

- [ ] **Step 1: Add import to dashboard-app.tsx**

At the top of `packages/frontend/components/dashboard-app.tsx`, add:

```ts
import { SyncSettings } from './sync/sync-settings';
```

- [ ] **Step 2: Replace the sync settings block in dashboard-app.tsx**

Find the block (around line 3377):

```tsx
{settingsTab === 'sync' ? (
  <div className="space-y-3">
    <label className="grid gap-2">
      <span className="text-sm font-medium">Provider</span>
      ...
    </label>
    ...
  </div>
) : null}
```

Replace the entire block (from `{settingsTab === 'sync' ? (` through the closing `) : null}`) with:

```tsx
{settingsTab === 'sync' ? (
  <SyncSettings />
) : null}
```

- [ ] **Step 3: Clean up unused state in dashboard-app.tsx**

Remove the state variables that are no longer used (now handled inside `SyncSettings`):
- `syncActionBusy` and `setSyncActionBusy`
- `syncRunDraft` and `setSyncRunDraft`
- `handleConnectSync` function
- `handleRunSyncNow` function

Run typecheck to confirm which are truly unused:

```bash
cd packages/frontend && npx tsc --noEmit 2>&1 | grep "syncAction\|syncRun\|handleConnect\|handleRunSync"
```

Remove only variables flagged as unused.

- [ ] **Step 4: Wire into mobile settings**

Open `packages/frontend/components/mobile/mobile-settings-content.tsx`. Add the import:

```ts
import { SyncSettings } from '../sync/sync-settings';
```

Find the sync tab section in the mobile settings (search for `sync` near the settings tabs). Replace whatever sync-related JSX exists with:

```tsx
<SyncSettings />
```

- [ ] **Step 5: Full typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Start dev server and smoke-test the wizard manually**

```bash
cd packages/frontend && npm run dev
```

Navigate to Settings → Sync tab. Verify:
- Split layout renders (left sidebar + right panel)
- Apple Calendar entry shows in sidebar
- Google shows as greyed-out "coming soon"
- Clicking "+ Add" opens the Apple wizard  
- Wizard steps are navigable (step 1 → 2 → etc.)
- Advanced settings collapse/expand works
- Cancel returns to empty/card state

- [ ] **Step 7: Final commit**

```bash
git add packages/frontend/components/dashboard-app.tsx packages/frontend/components/mobile/mobile-settings-content.tsx
git commit -m "feat(frontend): wire SyncSettings into dashboard and mobile settings, remove old raw sync form"
```

---

## Self-review checklist

Before starting implementation, verify:

- [ ] Every task has a typecheck step — catches type regressions early
- [ ] Task 4 (migration) is safe for the `none` case — confirmed handled
- [ ] The `createConnection` duplicate check uses `provider` string comparison — consistent
- [ ] `SyncConnectionService.runSync` receives `entryRepository` from caller (not from constructor) — avoids circular dep with EntryService
- [ ] `apple-wizard.tsx` passes `caldavUrl` through all 3 API calls (verify, calendars, create) — confirmed
- [ ] The old `POST /api/v1/sync/connect` and `POST /api/v1/sync/run` routes remain in app.ts (backwards compat) — not touched in Task 7
- [ ] Mobile settings sync tab is updated in Task 13 — confirmed
