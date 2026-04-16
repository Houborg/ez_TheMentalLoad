import type { Entry } from '@mental-load/contracts';

export interface EntryRepository {
  list(): Promise<Entry[]>;
  findById(id: string): Promise<Entry | undefined>;
  create(entry: Entry): Promise<Entry>;
  update(id: string, patch: Partial<Entry>): Promise<Entry | undefined>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryEntryRepository implements EntryRepository {
  constructor(private readonly entries: Entry[] = []) {}

  async list(): Promise<Entry[]> {
    return [...this.entries].sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  async findById(id: string): Promise<Entry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async create(entry: Entry): Promise<Entry> {
    this.entries.push(entry);
    return entry;
  }

  async update(id: string, patch: Partial<Entry>): Promise<Entry | undefined> {
    const current = this.entries.find((entry) => entry.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }

    this.entries.splice(index, 1);
    return true;
  }
}
