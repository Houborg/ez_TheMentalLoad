import type { Pool } from 'pg';
import type { AulaConfirmationRepository } from '../aula-confirmation-repository.js';

export class PostgresAulaConfirmationRepository implements AulaConfirmationRepository {
  constructor(private readonly pool: Pool) {}

  async listConfirmed(familyId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query(
      `select aula_item_id::text from aula_item_confirmations where family_id = $1`,
      [familyId],
    );
    return new Set(rows.map((r: { aula_item_id: string }) => r.aula_item_id));
  }

  async confirm(familyId: string, aulaItemId: string): Promise<void> {
    await this.pool.query(
      `insert into aula_item_confirmations (family_id, aula_item_id)
       values ($1, $2)
       on conflict (family_id, aula_item_id) do nothing`,
      [familyId, aulaItemId],
    );
  }

  async unconfirm(familyId: string, aulaItemId: string): Promise<void> {
    await this.pool.query(
      `delete from aula_item_confirmations where family_id = $1 and aula_item_id = $2`,
      [familyId, aulaItemId],
    );
  }
}
