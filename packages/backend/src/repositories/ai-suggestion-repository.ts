import type { AiSuggestion, AiSuggestionStatus, AiSuggestionCategory, AiActionType } from '@mental-load/contracts';

export interface CreateSuggestionInput {
  triggerType: AiSuggestion['triggerType'];
  triggerRef?: string;
  category: AiSuggestionCategory;
  text: string;
  actionType: AiActionType;
  actionData: Record<string, unknown>;
}

export interface AiSuggestionRepository {
  list(familyId: string, status?: AiSuggestionStatus): Promise<AiSuggestion[]>;
  findById(familyId: string, id: string): Promise<AiSuggestion | undefined>;
  create(familyId: string, input: CreateSuggestionInput): Promise<AiSuggestion>;
  setStatus(familyId: string, id: string, status: AiSuggestionStatus): Promise<boolean>;
  expireOld(familyId: string): Promise<number>;
  countByTriggerRef(familyId: string, triggerRef: string, since: Date): Promise<number>;
}

export class InMemoryAiSuggestionRepository implements AiSuggestionRepository {
  private rows: Array<AiSuggestion & { familyId: string }> = [];

  async list(familyId: string, status?: AiSuggestionStatus): Promise<AiSuggestion[]> {
    return this.rows
      .filter(r => r.familyId === familyId && (status === undefined || r.status === status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ familyId: _f, ...rest }) => rest);
  }

  async findById(familyId: string, id: string): Promise<AiSuggestion | undefined> {
    const row = this.rows.find(r => r.id === id && r.familyId === familyId);
    if (!row) return undefined;
    const { familyId: _f, ...rest } = row;
    return rest;
  }

  async create(familyId: string, input: CreateSuggestionInput): Promise<AiSuggestion> {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const row = {
      id: crypto.randomUUID(),
      familyId,
      ...input,
      status: 'pending' as AiSuggestionStatus,
      createdAt: now,
      expiresAt: expires,
    };
    this.rows.push(row);
    const { familyId: _f, ...rest } = row;
    return rest;
  }

  async setStatus(familyId: string, id: string, status: AiSuggestionStatus): Promise<boolean> {
    const row = this.rows.find(r => r.id === id && r.familyId === familyId);
    if (!row) return false;
    row.status = status;
    return true;
  }

  async expireOld(familyId: string): Promise<number> {
    const now = new Date().toISOString();
    const toExpire = this.rows.filter(
      r => r.familyId === familyId && r.status === 'pending' && r.expiresAt < now,
    );
    toExpire.forEach(r => { r.status = 'expired'; });
    return toExpire.length;
  }

  async countByTriggerRef(familyId: string, triggerRef: string, since: Date): Promise<number> {
    return this.rows.filter(
      r => r.familyId === familyId && r.triggerRef === triggerRef && r.createdAt >= since.toISOString(),
    ).length;
  }
}
