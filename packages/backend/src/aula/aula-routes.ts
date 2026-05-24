// packages/backend/src/aula/aula-routes.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { aulaAuthStart, aulaAuthPoll } from './aula-auth.js';
import { AulaClient } from './aula-client.js';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaSyncService } from './aula-sync-service.js';
import { AulaAuthExpiredError, AulaLoginError, type AulaChildMapping, type AulaSyncOptions, type AulaTokens } from './aula-types.js';
import type { DomainEventBus } from '../events/domain-event-bus.js';

export async function registerAulaRoutes(
  app: FastifyInstance,
  pool: Pool,
  eventBus?: DomainEventBus,
): Promise<void> {

  // POST /api/v1/aula/auth/start — start APP-method auth, returns session_id
  app.post<{ Body: { username: string } }>('/api/v1/aula/auth/start', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });
    const { username } = req.body;
    if (!username) return reply.status(400).send({ error: 'username is required' });
    try {
      const sessionId = await aulaAuthStart(username);
      return reply.send({ sessionId });
    } catch (err) {
      console.error('[aula/auth/start]', err);
      return reply.status(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/v1/aula/auth/poll/:sessionId — poll sidecar for QR codes / completion
  app.get<{ Params: { sessionId: string } }>('/api/v1/aula/auth/poll/:sessionId', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });
    try {
      const result = await aulaAuthPoll(req.params.sessionId);
      if (result.status === 'completed') {
        // Children are returned by the sidecar (avoids 410 from our REST client)
        const children = result.qrCodes ?? [];
        return reply.send({ ...result, children });
      }
      return reply.send(result);
    } catch (err) {
      console.error('[aula/auth/poll]', err);
      return reply.status(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{
    Body: {
      tokens: AulaTokens;
      tokenData?: Record<string, unknown>;
      aulaUsername: string;
      childMappings: AulaChildMapping[];
      syncOptions: AulaSyncOptions;
      syncIntervalMinutes?: number;
    };
  }>('/api/v1/aula/connect', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { tokens, tokenData, aulaUsername, childMappings, syncOptions, syncIntervalMinutes } = req.body;
    if (!tokens?.accessToken || !tokens?.refreshToken || !childMappings?.length) {
      return reply.status(400).send({ error: 'tokens and at least one childMapping are required' });
    }

    const svc = new AulaConnectionService(pool, familyId);
    const conn = await svc.saveConnection({
      isConnected: true,
      aulaUsername,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenData,
      childMappings,
      syncOptions,
      syncIntervalMinutes: syncIntervalMinutes ?? 60,
    });

    const { accessToken: _a, refreshToken: _r, ...pub } = conn;
    return reply.send({ connection: pub });
  });

  app.get('/api/v1/aula/connection', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaConnectionService(pool, familyId);
    const conn = await svc.getConnectionPublic();
    return reply.send({ connection: conn });
  });

  app.delete('/api/v1/aula/connection', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaConnectionService(pool, familyId);
    await svc.deleteConnection();
    return reply.send({ ok: true });
  });

  app.post('/api/v1/aula/sync', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const svc = new AulaSyncService(pool, familyId, eventBus);
    try {
      const stats = await svc.runSync();
      return reply.send({ ok: true, stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof AulaAuthExpiredError ? 'aula_auth_expired' : 'aula_sync_failed';
      return reply.status(502).send({ error: message, code });
    }
  });

  app.get<{
    Querystring: { type?: string; memberId?: string; page?: string; pageSize?: string; include_hidden?: string };
  }>('/api/v1/aula/items', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { type, memberId, page = '0', pageSize = '20', include_hidden } = req.query;
    const offset = Number(page) * Number(pageSize);

    const conditions: string[] = ['family_id = $1'];
    const params: unknown[] = [familyId];

    if (!include_hidden) conditions.push('hidden_at is null');
    if (type) { conditions.push(`type = $${params.length + 1}`); params.push(type); }
    if (memberId) { conditions.push(`member_id = $${params.length + 1}`); params.push(memberId); }

    params.push(Number(pageSize), offset);
    const result = await pool.query(
      `select id, aula_id, type, title, body, author, member_id, published_at, created_at
       from aula_items
       where ${conditions.join(' and ')}
       order by published_at desc nulls last, created_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    return reply.send({ items: result.rows });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/aula/items/:id', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });
    const result = await pool.query(
      `update aula_items set hidden_at = now()
       where id = $1 and family_id = $2 and hidden_at is null`,
      [req.params.id, familyId],
    );
    if ((result.rowCount ?? 0) === 0) return reply.status(404).send({ error: 'not_found' });
    return reply.send({ ok: true });
  });
}
