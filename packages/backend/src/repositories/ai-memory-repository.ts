import type { AiMemory, AiMemoryCategory, AiMemorySource } from '@mental-load/contracts';

export interface AiMemoryRepository {
  list(familyId: string, memberId?: string): Promise<AiMemory[]>;
  upsert(familyId: string, input: {
    memberId?: string;
    category: AiMemoryCategory;
    key: string;
    value: string;
    source: AiMemorySource;
  }): Promise<AiMemory>;
  delete(familyId: string, id: string): Promise<boolean>;
  deleteAll(familyId: string): Promise<void>;
}

export class InMemoryAiMemoryRepository implements AiMemoryRepository {
  private rows: Array<AiMemory & { familyId: string }> = [];

  async list(familyId: string, memberId?: string): Promise<AiMemory[]> {
    return this.rows
      .filter(r => r.familyId === familyId && (memberId === undefined || r.memberId === memberId))
      .map(({ familyId: _f, ...rest }) => rest);
  }

  async upsert(familyId: string, input: {
    memberId?: string;
    category: AiMemoryCategory;
    key: string;
    value: string;
    source: AiMemorySource;
  }): Promise<AiMemory> {
    const existing = this.rows.find(
      r => r.familyId === familyId && r.key === input.key && r.memberId === input.memberId,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.value = input.value;
      existing.source = input.source;
      existing.updatedAt = now;
      const { familyId: _f, ...rest } = existing;
      return rest;
    }
    const row = {
      id: crypto.randomUUID(),
      familyId,
      memberId: input.memberId,
      category: input.category,
      key: input.key,
      value: input.value,
      source: input.source,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    const { familyId: _f, ...rest } = row;
    return rest;
  }

  async delete(familyId: string, id: string): Promise<boolean> {
    const idx = this.rows.findIndex(r => r.id === id && r.familyId === familyId);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async deleteAll(familyId: string): Promise<void> {
    this.rows = this.rows.filter(r => r.familyId !== familyId);
  }
}
