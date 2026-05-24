import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool, QueryResult } from 'pg';
import { registerAulaRoutes } from './aula-routes.js';

function makeApp(rows: Record<string, unknown>[], capture: Array<{ sql: string; params?: unknown[] }> = []) {
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      capture.push({ sql, params });
      if (/select id, aula_id, type/i.test(sql)) return { rows } as unknown as QueryResult;
      if (/^\s*update aula_items set hidden_at/i.test(sql)) {
        return { rowCount: rows.length, rows: [] } as unknown as QueryResult;
      }
      return { rowCount: 0, rows: [] } as unknown as QueryResult;
    },
  } as unknown as Pool;
  const app = Fastify();
  // Inject familyId on every request so the auth guard is satisfied.
  app.addHook('onRequest', async (req) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).familyId = 'fam-1';
  });
  registerAulaRoutes(app, pool);
  return { app, capture };
}

test('GET /aula/items filters hidden_at IS NULL by default', async () => {
  const capture: Array<{ sql: string; params?: unknown[] }> = [];
  const { app } = makeApp([], capture);
  const res = await app.inject({ method: 'GET', url: '/api/v1/aula/items' });
  assert.equal(res.statusCode, 200);
  const listQuery = capture.find(q => /from aula_items/i.test(q.sql));
  assert.ok(listQuery);
  assert.match(listQuery!.sql, /hidden_at is null/i);
});

test('GET /aula/items?include_hidden=1 skips the hidden filter', async () => {
  const capture: Array<{ sql: string; params?: unknown[] }> = [];
  const { app } = makeApp([], capture);
  const res = await app.inject({ method: 'GET', url: '/api/v1/aula/items?include_hidden=1' });
  assert.equal(res.statusCode, 200);
  const listQuery = capture.find(q => /from aula_items/i.test(q.sql));
  assert.doesNotMatch(listQuery!.sql, /hidden_at is null/i);
});

test('DELETE /aula/items/:id sets hidden_at and returns ok', async () => {
  const capture: Array<{ sql: string; params?: unknown[] }> = [];
  const { app } = makeApp([{ id: 'item-1' }], capture);
  const res = await app.inject({ method: 'DELETE', url: '/api/v1/aula/items/item-1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  const updateQuery = capture.find(q => /^\s*update aula_items set hidden_at/i.test(q.sql));
  assert.ok(updateQuery, 'expected an UPDATE statement');
  assert.deepEqual(updateQuery!.params, ['item-1', 'fam-1']);
});

test('DELETE /aula/items/:id returns 404 when no row matches the family', async () => {
  const capture: Array<{ sql: string; params?: unknown[] }> = [];
  const { app } = makeApp([], capture);
  const res = await app.inject({ method: 'DELETE', url: '/api/v1/aula/items/item-1' });
  assert.equal(res.statusCode, 404);
});
