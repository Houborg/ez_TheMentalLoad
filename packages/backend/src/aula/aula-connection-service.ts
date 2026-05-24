// packages/backend/src/aula/aula-connection-service.ts
import { v4 as uuid } from 'uuid';
import type { Pool } from 'pg';
import type { AulaConnection, AulaConnectionPublic, AulaTokens } from './aula-types.js';

export class AulaConnectionService {
  constructor(private readonly pool: Pool, private readonly familyId: string) {}

  async getConnection(): Promise<AulaConnection | null> {
    const result = await this.pool.query<{ settings_json: Record<string, unknown> }>(
      'select settings_json from families where id = $1',
      [this.familyId],
    );
    const raw = result.rows[0]?.settings_json ?? {};
    const conn = raw.aula_connection as AulaConnection | undefined;
    if (!conn) return null;
    // Default new sync options to true for connections persisted before the field existed.
    const storedOpts = conn.syncOptions as Partial<AulaConnection['syncOptions']>;
    return {
      ...conn,
      syncOptions: {
        mu_tasks: true,
        presence: true,
        ...storedOpts,
      } as AulaConnection['syncOptions'],
    };
  }

  async getConnectionPublic(): Promise<AulaConnectionPublic | null> {
    const conn = await this.getConnection();
    if (!conn) return null;
    const { accessToken: _a, refreshToken: _r, ...pub } = conn;
    return pub;
  }

  async saveConnection(conn: Omit<AulaConnection, 'id' | 'createdAt'>): Promise<AulaConnection> {
    const existing = await this.getConnection();
    const full: AulaConnection = {
      id: existing?.id ?? uuid(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      ...conn,
    };
    await this.pool.query(
      `update families
       set settings_json = jsonb_set(settings_json, '{aula_connection}', $1::jsonb)
       where id = $2`,
      [JSON.stringify(full), this.familyId],
    );
    return full;
  }

  async updateTokens(tokens: AulaTokens): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({ ...conn, ...tokens });
  }

  async updateSyncStats(stats: { entriesCreated: number; itemsCreated: number }): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({
      ...conn,
      lastSyncAt: new Date().toISOString(),
      lastSyncStats: stats,
    });
  }

  async setConnected(isConnected: boolean): Promise<void> {
    const conn = await this.getConnection();
    if (!conn) return;
    await this.saveConnection({ ...conn, isConnected });
  }

  async deleteConnection(): Promise<void> {
    await this.pool.query(
      `update families
       set settings_json = settings_json - 'aula_connection'
       where id = $1`,
      [this.familyId],
    );
  }
}
