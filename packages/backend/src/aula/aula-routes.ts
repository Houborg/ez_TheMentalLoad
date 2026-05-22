// packages/backend/src/aula/aula-routes.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { aulaLogin } from './aula-auth.js';
import { AulaClient } from './aula-client.js';
import { AulaConnectionService } from './aula-connection-service.js';
import { AulaSyncService } from './aula-sync-service.js';
import { AulaLoginError, type AulaChildMapping, type AulaSyncOptions, type AulaTokens } from './aula-types.js';

export async function registerAulaRoutes(app: FastifyInstance, pool: Pool): Promise<void> {

  app.post<{
    Body: { username: string; password: string; code: string };
  }>('/api/v1/aula/auth/verify', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { username, password, code } = req.body;
    if (!username || !password || !code) {
      return reply.status(400).send({ error: 'username, password and code are required' });
    }

    try {
      const tokens = await aulaLogin(username, password, code);
      const client = new AulaClient(tokens);
      const children = await client.getChildren();
      return reply.send({ children, tokens });
    } catch (err) {
      if (err instanceof AulaLoginError) {
        const status = err.code === 'expired_code' ? 400 : 401;
        const message =
          err.code === 'invalid_credentials' ? 'Forkert brugernavn eller adgangskode' :
          err.code === 'expired_code' ? 'Koden er udløbet — hent en ny i MitID-appen' :
          'Kunne ikke forbinde til Aula';
        return reply.status(status).send({ error: message, code: err.code });
      }
      req.log.error({ err }, 'Aula auth/verify unexpected error');
      return reply.status(500).send({ error: 'Uventet fejl under login' });
    }
  });

  app.post<{
    Body: {
      tokens: AulaTokens;
      aulaUsername: string;
      childMappings: AulaChildMapping[];
      syncOptions: AulaSyncOptions;
      syncIntervalMinutes?: number;
    };
  }>('/api/v1/aula/connect', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { tokens, aulaUsername, childMappings, syncOptions, syncIntervalMinutes } = req.body;
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

    const svc = new AulaSyncService(pool, familyId);
    const stats = await svc.runSync();
    return reply.send({ ok: true, stats });
  });

  app.get<{
    Querystring: { type?: string; memberId?: string; page?: string; pageSize?: string };
  }>('/api/v1/aula/items', async (req, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (req as any).familyId as string | undefined;
    if (!familyId) return reply.status(401).send({ error: 'unauthorized' });

    const { type, memberId, page = '0', pageSize = '20' } = req.query;
    const offset = Number(page) * Number(pageSize);

    const conditions: string[] = ['family_id = $1'];
    const params: unknown[] = [familyId];

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
}
