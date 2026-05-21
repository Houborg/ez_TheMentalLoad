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

function mockPool(settingsJson: Record<string, unknown> = {}): { pool: Pool; stored: unknown[] } {
  const stored: unknown[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      if (sql.includes('select settings_json')) {
        return { rows: [{ settings_json: settingsJson }] } as unknown as QueryResult;
      }
      if (sql.includes('update families') || sql.includes('jsonb_set')) {
        stored.push(params?.[0]);
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

test('listConnections returns existing connections', async () => {
  const existing = [{ id: 'conn-1', provider: 'apple', isConnected: true, importEnabled: true, exportEnabled: false, syncIntervalMinutes: 15, createdAt: new Date().toISOString() }];
  const { pool } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const result = await svc.listConnections();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'conn-1');
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
  assert.ok(conn.id, 'should have generated an id');
  assert.ok(stored.length > 0, 'should have written to the pool');
});

test('createConnection rejects duplicate provider', async () => {
  const existing = [{ id: 'conn-1', provider: 'apple', isConnected: true, importEnabled: true, exportEnabled: false, syncIntervalMinutes: 15, createdAt: new Date().toISOString() }];
  const { pool } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  await assert.rejects(
    () => svc.createConnection({ provider: 'apple', importEnabled: true, exportEnabled: false }),
    /already connected/i,
  );
});

test('verify delegates to adapter and returns true', async () => {
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

test('verify returns false when adapter rejects', async () => {
  const { pool } = mockPool({});
  const adapter = new MockAdapter();
  adapter.verified = false;
  const svc = new SyncConnectionService(pool, 'fam-1', adapter);
  const ok = await svc.verify({ provider: 'apple', caldavUrl: 'https://caldav.icloud.com', username: 'x', password: 'y' });
  assert.equal(ok, false);
});

test('updateConnection patches the matching connection', async () => {
  const existing = [{ id: 'conn-1', provider: 'apple', isConnected: true, importEnabled: true, exportEnabled: false, syncIntervalMinutes: 15, createdAt: new Date().toISOString() }];
  const { pool } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const updated = await svc.updateConnection('conn-1', { syncIntervalMinutes: 30 });
  assert.equal(updated.syncIntervalMinutes, 30);
});

test('updateConnection throws when id not found', async () => {
  const { pool } = mockPool({ sync_connections: [] });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  await assert.rejects(
    () => svc.updateConnection('no-such-id', { syncIntervalMinutes: 30 }),
    /not found/i,
  );
});

test('deleteConnection removes the matching entry', async () => {
  const existing = [
    { id: 'conn-1', provider: 'apple', isConnected: true, importEnabled: true, exportEnabled: false, syncIntervalMinutes: 15, createdAt: new Date().toISOString() },
    { id: 'conn-2', provider: 'google', isConnected: false, importEnabled: true, exportEnabled: false, syncIntervalMinutes: 15, createdAt: new Date().toISOString() },
  ];
  const { pool, stored } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  await svc.deleteConnection('conn-1');
  // The saved value should be the JSON string of the remaining connections
  const saved = JSON.parse(stored[stored.length - 1] as string) as unknown[];
  assert.equal(saved.length, 1);
  assert.equal((saved[0] as { id: string }).id, 'conn-2');
});

test('runSync imports events when importEnabled', async () => {
  const existing = [{
    id: 'conn-1', provider: 'apple', isConnected: true,
    importEnabled: true, exportEnabled: false,
    syncIntervalMinutes: 15, createdAt: new Date().toISOString(),
    caldavUrl: 'https://caldav.icloud.com', appPassword: 'xxxx', calendarPath: '/cal/',
    appleId: 'far@icloud.com',
  }];
  const { pool } = mockPool({ sync_connections: existing });
  const adapter = new MockAdapter();
  adapter.events = [
    { uid: 'uid-1', url: '/cal/1.ics', etag: '"1"', icalData: 'BEGIN:VCALENDAR\nEND:VCALENDAR' },
    { uid: 'uid-2', url: '/cal/2.ics', etag: '"2"', icalData: 'BEGIN:VCALENDAR\nEND:VCALENDAR' },
  ];
  const svc = new SyncConnectionService(pool, 'fam-1', adapter);
  const result = await svc.runSync('conn-1', { list: async () => [] });
  assert.equal(result.importedCount, 2);
  assert.equal(result.exportedCount, 0);
});

test('runSync skips when isConnected is false', async () => {
  const existing = [{
    id: 'conn-1', provider: 'apple', isConnected: false,
    importEnabled: true, exportEnabled: true,
    syncIntervalMinutes: 15, createdAt: new Date().toISOString(),
  }];
  const { pool } = mockPool({ sync_connections: existing });
  const svc = new SyncConnectionService(pool, 'fam-1', new MockAdapter());
  const result = await svc.runSync('conn-1', { list: async () => [] });
  assert.equal(result.importedCount, 0);
  assert.equal(result.exportedCount, 0);
});
