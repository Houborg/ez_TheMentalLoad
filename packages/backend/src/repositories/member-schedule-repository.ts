import type { MemberScheduleEntry } from '@mental-load/contracts';

export interface MemberScheduleRepository {
  list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]>;
  create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry>;
  delete(familyId: string, entryId: string): Promise<boolean>;
  setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean>;
}

export class InMemoryMemberScheduleRepository implements MemberScheduleRepository {
  private rows: Array<MemberScheduleEntry & { familyId: string; _confirmed: boolean }> = [];

  async list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]> {
    return this.rows
      .filter(r => r.familyId === familyId && r.memberId === memberId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
      .map(r => ({ ...r, confirmed: r._confirmed }));
  }

  async create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry> {
    const row = {
      id: crypto.randomUUID(),
      memberId,
      familyId,
      _confirmed: false,
      confirmed: false,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.rows.push(row);
    return { id: row.id, memberId: row.memberId, dayOfWeek: row.dayOfWeek, title: row.title, startTime: row.startTime, endTime: row.endTime, confirmed: false, createdAt: row.createdAt };
  }

  async delete(familyId: string, entryId: string): Promise<boolean> {
    const idx = this.rows.findIndex(r => r.id === entryId && r.familyId === familyId);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean> {
    const row = this.rows.find(r => r.id === entryId && r.familyId === familyId);
    if (!row) return false;
    row._confirmed = confirmed;
    return true;
  }
}
