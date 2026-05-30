import type { Pool } from 'pg';
import type { AiMemory, AiMemoryCategory, AiMemorySource } from '@mental-load/contracts';
import type { AiMemoryRepository } from '../ai-memory-repository.js';

function rowToMemory(row: Record<string, unknown>): AiMemory {
  return {
    id: String(row.id),
    memberId: row.member_id ? String(row.member_id) : undefined,
    category: String(row.category) as AiMemoryCategory,
    key: String(row.key),
    value: String(row.value),
    source: String(row.source) as AiMemorySource,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PostgresAiMemoryRepository implements AiMemoryRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId: string, memberId?: string): Promise<AiMemory[]> {
    const query = memberId
      ? 'select * from ai_memory where family_id = $1 and member_id = $2 order by updated_at desc'
      : 'select * from ai_memory where family_id = $1 order by updated_at desc';
    const params = memberId ? [familyId, memberId] : [familyId];
    const { rows } = await this.pool.query(query, params);
    return rows.map(rowToMemory);
  }

  async upsert(familyId: string, input: {
    memberId?: string;
    category: AiMemoryCategory;
    key: string;
    value: string;
    source: AiMemorySource;
  }): Promise<AiMemory> {
    const { rows } = await this.pool.query(
      `insert into ai_memory (family_id, member_id, category, key, value, source)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (family_id, key, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
         set value = excluded.value, source = excluded.source, updated_at = now()
       returning *`,
      [familyId, input.memberId ?? null, input.category, input.key, input.value, input.source],
    );
    return rowToMemory(rows[0]);
  }

  async delete(familyId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'delete from ai_memory where id = $1 and family_id = $2',
      [id, familyId],
    );
    return (rowCount ?? 0) > 0;
  }

  async deleteAll(familyId: string): Promise<void> {
    await this.pool.query('delete from ai_memory where family_id = $1', [familyId]);
  }
}
