import type { Pool } from 'pg';
import type { AiSuggestion, AiSuggestionStatus, AiSuggestionCategory, AiActionType } from '@mental-load/contracts';
import type { AiSuggestionRepository, CreateSuggestionInput } from '../ai-suggestion-repository.js';

function rowToSuggestion(row: Record<string, unknown>): AiSuggestion {
  return {
    id: String(row.id),
    triggerType: String(row.trigger_type) as AiSuggestion['triggerType'],
    triggerRef: row.trigger_ref ? String(row.trigger_ref) : undefined,
    category: String(row.category) as AiSuggestionCategory,
    text: String(row.text),
    actionType: String(row.action_type) as AiActionType,
    actionData: (row.action_data as Record<string, unknown>) ?? {},
    status: String(row.status) as AiSuggestionStatus,
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
  };
}

export class PostgresAiSuggestionRepository implements AiSuggestionRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId: string, status?: AiSuggestionStatus): Promise<AiSuggestion[]> {
    const query = status
      ? 'select * from ai_suggestions where family_id = $1 and status = $2 order by created_at desc limit 50'
      : 'select * from ai_suggestions where family_id = $1 order by created_at desc limit 50';
    const params = status ? [familyId, status] : [familyId];
    const { rows } = await this.pool.query(query, params);
    return rows.map(rowToSuggestion);
  }

  async findById(familyId: string, id: string): Promise<AiSuggestion | undefined> {
    const { rows } = await this.pool.query(
      'select * from ai_suggestions where id = $1 and family_id = $2',
      [id, familyId],
    );
    return rows[0] ? rowToSuggestion(rows[0]) : undefined;
  }

  async create(familyId: string, input: CreateSuggestionInput): Promise<AiSuggestion> {
    const { rows } = await this.pool.query(
      `insert into ai_suggestions
         (family_id, trigger_type, trigger_ref, category, text, action_type, action_data)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [familyId, input.triggerType, input.triggerRef ?? null, input.category,
       input.text, input.actionType, JSON.stringify(input.actionData)],
    );
    return rowToSuggestion(rows[0]);
  }

  async setStatus(familyId: string, id: string, status: AiSuggestionStatus): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'update ai_suggestions set status = $3 where id = $1 and family_id = $2',
      [id, familyId, status],
    );
    return (rowCount ?? 0) > 0;
  }

  async expireOld(familyId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update ai_suggestions
       set status = 'expired'
       where family_id = $1 and status = 'pending' and expires_at < now()`,
      [familyId],
    );
    return rowCount ?? 0;
  }

  async countByTriggerRef(familyId: string, triggerRef: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from ai_suggestions
       where family_id = $1 and trigger_ref = $2 and created_at >= $3`,
      [familyId, triggerRef, since.toISOString()],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
