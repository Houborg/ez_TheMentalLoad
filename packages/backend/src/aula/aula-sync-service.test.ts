import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';

function makePool(): { pool: Pool; queries: Array<{ sql: string; params?: unknown[] }> } {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });
      if (/^\s*select id from entries/i.test(sql)) return { rows: [] } as unknown as QueryResult;
      if (/^\s*select settings_json/i.test(sql)) return { rows: [{ settings_json: {} }] } as unknown as QueryResult;
      return { rowCount: 1, rows: [] } as unknown as QueryResult;
    },
  } as unknown as Pool;
  return { pool, queries };
}

test('upsertAulaItem (insert mode) uses "on conflict do nothing"', async () => {
  const { AulaSyncService } = await import('./aula-sync-service.js');
  const { pool, queries } = makePool();
  const svc = new AulaSyncService(pool, 'fam');
  // call the private method via a forced cast — acceptable in unit tests
  await (svc as unknown as { upsertAulaItem: (i: unknown) => Promise<boolean> }).upsertAulaItem({
    aulaId: 'msg-1', type: 'message', title: 't', body: 'b',
    memberId: null, publishedAt: null, rawJson: {}, mode: 'insert',
  });
  const insertCall = queries.find(q => /insert into aula_items/i.test(q.sql));
  assert.ok(insertCall);
  assert.match(insertCall!.sql, /on conflict.*do nothing/i);
});

test('upsertAulaItem (upsert mode) uses "on conflict do update" and does NOT touch hidden_at', async () => {
  const { AulaSyncService } = await import('./aula-sync-service.js');
  const { pool, queries } = makePool();
  const svc = new AulaSyncService(pool, 'fam');
  await (svc as unknown as { upsertAulaItem: (i: unknown) => Promise<boolean> }).upsertAulaItem({
    aulaId: 'presence-123', type: 'presence', title: 'tilstede', body: 'Tilstede',
    memberId: 'm', publishedAt: new Date().toISOString(), rawJson: {}, mode: 'upsert',
  });
  const insertCall = queries.find(q => /insert into aula_items/i.test(q.sql));
  assert.ok(insertCall);
  assert.match(insertCall!.sql, /on conflict.*do update set/i);
  assert.doesNotMatch(insertCall!.sql, /hidden_at/i);
});

test('runSync inserts mu_task rows per child mapping when sidecar returns mu_tasks', async () => {
  // mock global fetch to return a sidecar response with one mu_task per child
  const originalFetch = global.fetch;
  global.fetch = (async () => new Response(JSON.stringify({
    calendar_events: [],
    weekplan_lessons: [],
    posts: [],
    messages: [],
    mu_tasks: [
      { childId: 100, id: 'mu-1', title: 'Læs side 12', subject: 'Dansk', dueDate: '2026-05-30',
        description: '<p>Læs</p>', status: 'open' },
    ],
    presence: [],
  }), { status: 200 })) as unknown as typeof fetch;

  try {
    const { AulaSyncService } = await import('./aula-sync-service.js');
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const pool = {
      async query(sql: string, params?: unknown[]) {
        queries.push({ sql, params });
        if (/select settings_json/i.test(sql)) {
          return { rows: [{ settings_json: { aula_connection: {
            id: 'c', isConnected: true, aulaUsername: 'u',
            accessToken: 'a', refreshToken: 'r',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            tokenData: { foo: 'bar' },
            childMappings: [{ aulaChildId: 100, aulaChildName: 'Nynne',
              mentalLoadMemberId: 'mem-nynne', calendarId: 'cal-nynne' }],
            // muTasks: true is the key flag being tested here
            syncOptions: { importToCalendar: false, calendarEvents: false, dailyOverview: false,
              posts: false, messages: false, muTasks: true, presence: false },
            syncIntervalMinutes: 60,
            createdAt: new Date().toISOString(),
          }}}] };
        }
        return { rowCount: 1, rows: [] };
      },
    } as unknown as Pool;

    const svc = new AulaSyncService(pool, 'fam');
    const stats = await svc.runSync();
    assert.equal(stats.itemsCreated, 1);
    const insertCall = queries.find(q =>
      /insert into aula_items/i.test(q.sql) &&
      (q.params as unknown[] | undefined)?.[2] === 'mu_task');
    assert.ok(insertCall, 'expected an mu_task insert');
    assert.equal((insertCall!.params as unknown[])[1], 'mu-mu-1');     // aulaId
    assert.equal((insertCall!.params as unknown[])[6], 'mem-nynne');   // member_id
  } finally {
    global.fetch = originalFetch;
  }
});
