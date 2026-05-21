import type { Entry } from '@mental-load/contracts';

export interface EntryRepository {
  list(familyId?: string): Promise<Entry[]>;
  findById(id: string, familyId?: string): Promise<Entry | undefined>;
  findByExternalUid(uid: string, familyId?: string): Promise<Entry | undefined>;
  findByOwnerAndAssignedMember(ownerMemberId: string, assignedToMemberId: string, familyId?: string): Promise<Entry[]>;
  create(entry: Entry, familyId?: string): Promise<Entry>;
  update(id: string, patch: Partial<Entry>, familyId?: string): Promise<Entry | undefined>;
  delete(id: string, familyId?: string): Promise<boolean>;
}

export class InMemoryEntryRepository implements EntryRepository {
  constructor(private readonly entries: Entry[] = []) {}

  async list(_familyId?: string): Promise<Entry[]> {
    return [...this.entries].sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  async findById(id: string, _familyId?: string): Promise<Entry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async findByExternalUid(uid: string, _familyId?: string): Promise<Entry | undefined> {
    return this.entries.find((entry) => entry.externalUid === uid);
  }

  async findByOwnerAndAssignedMember(ownerMemberId: string, assignedToMemberId: string, _familyId?: string): Promise<Entry[]> {
    return this.entries
      .filter((entry) => entry.ownerMemberId === ownerMemberId && entry.assignedToMemberId === assignedToMemberId)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  async create(entry: Entry, _familyId?: string): Promise<Entry> {
    this.entries.push(entry);
    return entry;
  }

  async update(id: string, patch: Partial<Entry>, _familyId?: string): Promise<Entry | undefined> {
    const current = this.entries.find((entry) => entry.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
  }

  async delete(id: string, _familyId?: string): Promise<boolean> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }

    this.entries.splice(index, 1);
    return true;
  }
}
