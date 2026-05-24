// packages/backend/src/aula/aula-connection-service.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';
import { AulaConnectionService } from './aula-connection-service.js';
import type { AulaConnection } from './aula-types.js';

function mockPool(settingsJson: Record<string, unknown> = {}): { pool: Pool; stored: unknown[] } {
  const stored: unknown[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      if (sql.includes('select settings_json')) {
        return { rows: [{ settings_json: settingsJson }] } as unknown as QueryResult;
      }
      if (sql.includes('update families')) {
        stored.push(params?.[0]);
        return { rows: [] } as unknown as QueryResult;
      }
      return { rows: [] } as unknown as QueryResult;
    },
  } as unknown as Pool;
  return { pool, stored };
}

const fakeConn: Omit<AulaConnection, 'id' | 'createdAt'> = {
  isConnected: true,
  aulaUsername: 'testuser',
  accessToken: 'acc',
  refreshToken: 'ref',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  childMappings: [],
  syncOptions: {
    importToCalendar: false,
    calendarEvents: true,
    dailyOverview: false,
    posts: false,
    messages: false,
    muTasks: true,
    presence: true,
  },
  syncIntervalMinutes: 60,
};

test('getConnection returns null when not set', async () => {
  const { pool } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  assert.equal(await svc.getConnection(), null);
});

test('getConnectionPublic strips tokens', async () => {
  const existing: AulaConnection = { id: 'c1', createdAt: new Date().toISOString(), ...fakeConn };
  const { pool } = mockPool({ aula_connection: existing });
  const svc = new AulaConnectionService(pool, 'fam-1');
  const pub = await svc.getConnectionPublic();
  assert.ok(pub);
  assert.ok(!('accessToken' in pub));
  assert.ok(!('refreshToken' in pub));
  assert.equal(pub.aulaUsername, 'testuser');
});

test('saveConnection generates id and createdAt when not existing', async () => {
  const { pool, stored } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  const saved = await svc.saveConnection(fakeConn);
  assert.ok(saved.id);
  assert.ok(saved.createdAt);
  assert.equal(stored.length, 1);
});

test('deleteConnection issues an update query', async () => {
  const { pool, stored } = mockPool({});
  const svc = new AulaConnectionService(pool, 'fam-1');
  await svc.deleteConnection();
  assert.equal(stored[0], 'fam-1');
});

test('getConnection defaults muTasks and presence to true for legacy connections', async () => {
  const legacyConn = {
    id: 'legacy',
    createdAt: new Date().toISOString(),
    isConnected: true,
    aulaUsername: 'legacy',
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    childMappings: [],
    syncOptions: {
      importToCalendar: false,
      calendarEvents: true,
      dailyOverview: false,
      posts: false,
      messages: false,
      // muTasks + presence missing on purpose
    },
    syncIntervalMinutes: 60,
  };
  const { pool } = mockPool({ aula_connection: legacyConn });
  const svc = new AulaConnectionService(pool, 'fam');
  const conn = await svc.getConnection();
  assert.equal(conn?.syncOptions.muTasks, true);
  assert.equal(conn?.syncOptions.presence, true);
});
