import type { ChecklistItem, Entry, Invitee, ReminderConfig } from '@mental-load/contracts';
import type { Pool, PoolClient } from 'pg';
import type { EntryRepository } from '../entry-repository';

export class PostgresEntryRepository implements EntryRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId?: string): Promise<Entry[]> {
    if (!familyId) return [];
    const result = await this.pool.query(
      'select * from entries where family_id = $1 order by start_time asc, created_at asc',
      [familyId],
    );

    const entries = result.rows.map((row) => this.mapBaseEntry(row));
    return this.enrichEntries(entries);
  }

  async findById(id: string, familyId?: string): Promise<Entry | undefined> {
    if (!familyId) return undefined;
    const result = await this.pool.query(
      'select * from entries where id = $1 and family_id = $2',
      [id, familyId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const [entry] = await this.enrichEntries([this.mapBaseEntry(row)]);
    return entry;
  }

  async findByOwnerAndAssignedMember(ownerMemberId: string, assignedToMemberId: string, familyId?: string): Promise<Entry[]> {
    if (!familyId) return [];
    const result = await this.pool.query(
      'select * from entries where owner_member_id = $1 and assigned_to_member_id = $2 and family_id = $3 order by start_time asc, created_at asc',
      [ownerMemberId, assignedToMemberId, familyId],
    );

    const entries = result.rows.map((row) => this.mapBaseEntry(row));
    return this.enrichEntries(entries);
  }

  async create(entry: Entry, familyId?: string): Promise<Entry> {
    if (!familyId) throw new Error('familyId required for create');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.writeEntry(entry, familyId, client);
      await client.query('commit');
      return entry;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, patch: Partial<Entry>, familyId?: string): Promise<Entry | undefined> {
    if (!familyId) return undefined;
    const current = await this.findById(id, familyId);
    if (!current) {
      return undefined;
    }

    const updated: Entry = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from entry_reminders where entry_id = $1', [id]);
      await client.query('delete from entry_checklist_items where entry_id = $1', [id]);
      await client.query('delete from entry_invitees where entry_id = $1', [id]);
      await client.query(
        'update entries set title = $2, type = $3, owner_member_id = $4, calendar_id = $5, start_time = $6, end_time = $7, all_day = $8, location = $9, status = $10, recurrence_rule = $11, parent_entry_id = $12, timezone = $13, assigned_to_member_id = $14, updated_at = $15 where id = $1 and family_id = $16',
        [
          id,
          updated.title,
          updated.type,
          updated.ownerMemberId,
          updated.calendarId,
          updated.startTime,
          updated.endTime,
          updated.allDay,
          updated.location ?? null,
          updated.status,
          updated.recurrenceRule ?? null,
          updated.parentEntryId ?? null,
          updated.timezone,
          updated.assignedToMemberId ?? null,
          updated.updatedAt,
          familyId,
        ],
      );
      await this.writeRelations(updated, client);
      await client.query('commit');
      return updated;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: string, familyId?: string): Promise<boolean> {
    if (!familyId) return false;
    const result = await this.pool.query(
      'delete from entries where id = $1 and family_id = $2',
      [id, familyId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async writeEntry(entry: Entry, familyId: string, client: PoolClient): Promise<void> {
    await client.query(
      'insert into entries (id, title, type, owner_member_id, calendar_id, start_time, end_time, all_day, location, status, recurrence_rule, parent_entry_id, timezone, assigned_to_member_id, created_at, updated_at, family_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
      [
        entry.id,
        entry.title,
        entry.type,
        entry.ownerMemberId,
        entry.calendarId,
        entry.startTime,
        entry.endTime,
        entry.allDay,
        entry.location ?? null,
        entry.status,
        entry.recurrenceRule ?? null,
        entry.parentEntryId ?? null,
        entry.timezone,
        entry.assignedToMemberId ?? null,
        entry.createdAt,
        entry.updatedAt,
        familyId,
      ],
    );

    await this.writeRelations(entry, client);
  }

  private async writeRelations(entry: Entry, client: PoolClient): Promise<void> {
    for (const reminder of entry.reminders) {
      await client.query(
        'insert into entry_reminders (id, entry_id, minutes_before, created_at) values ($1, $2, $3, now())',
        [reminder.id, entry.id, reminder.minutesBefore],
      );
    }

    for (const item of entry.checklist) {
      await client.query(
        'insert into entry_checklist_items (id, entry_id, text, is_completed, assigned_to_member_id) values ($1, $2, $3, $4, $5)',
        [item.id, entry.id, item.text, item.isCompleted, item.assignedToMemberId ?? null],
      );
    }

    for (const invitee of entry.invitees) {
      await client.query(
        'insert into entry_invitees (id, entry_id, email, status) values ($1, $2, $3, $4)',
        [invitee.id, entry.id, invitee.email, invitee.status],
      );
    }
  }

  private async enrichEntries(entries: Entry[]): Promise<Entry[]> {
    if (entries.length === 0) {
      return [];
    }

    const ids = entries.map((entry) => entry.id);
    const remindersResult = await this.pool.query(
      'select id, entry_id, minutes_before from entry_reminders where entry_id = any($1::uuid[])',
      [ids],
    );
    const checklistResult = await this.pool.query(
      'select id, entry_id, text, is_completed, assigned_to_member_id from entry_checklist_items where entry_id = any($1::uuid[])',
      [ids],
    );
    const inviteesResult = await this.pool.query(
      'select id, entry_id, email, status from entry_invitees where entry_id = any($1::uuid[])',
      [ids],
    );
    const linkedResult = await this.pool.query(
      'select id, parent_entry_id from entries where parent_entry_id = any($1::uuid[])',
      [ids],
    );

    return entries.map((entry) => ({
      ...entry,
      reminders: remindersResult.rows
        .filter((row) => row.entry_id === entry.id)
        .map((row) => ({ id: row.id, minutesBefore: row.minutes_before })) as ReminderConfig[],
      checklist: checklistResult.rows
        .filter((row) => row.entry_id === entry.id)
        .map((row) => ({ id: row.id, text: row.text, isCompleted: row.is_completed, assignedToMemberId: row.assigned_to_member_id })) as ChecklistItem[],
      invitees: inviteesResult.rows
        .filter((row) => row.entry_id === entry.id)
        .map((row) => ({ id: row.id, email: row.email, status: row.status })) as Invitee[],
      linkedEntryIds: linkedResult.rows
        .filter((row) => row.parent_entry_id === entry.id)
        .map((row) => row.id),
    }));
  }

  private mapBaseEntry(row: Record<string, unknown>): Entry {
    return {
      id: String(row.id),
      title: String(row.title),
      type: row.type as Entry['type'],
      ownerMemberId: String(row.owner_member_id),
      calendarId: String(row.calendar_id),
      startTime: new Date(String(row.start_time)).toISOString(),
      endTime: new Date(String(row.end_time)).toISOString(),
      timezone: String(row.timezone ?? 'UTC'),
      allDay: Boolean(row.all_day),
      reminders: [],
      checklist: [],
      status: row.status as Entry['status'],
      location: row.location ? String(row.location) : undefined,
      recurrenceRule: row.recurrence_rule ? String(row.recurrence_rule) : undefined,
      invitees: [],
      linkedEntryIds: [],
      parentEntryId: row.parent_entry_id ? String(row.parent_entry_id) : undefined,
      assignedToMemberId: row.assigned_to_member_id ? String(row.assigned_to_member_id) : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
