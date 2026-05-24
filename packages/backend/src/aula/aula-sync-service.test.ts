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
