import type { Pool } from 'pg';
import type { MemberScheduleEntry } from '@mental-load/contracts';
import type { MemberScheduleRepository } from '../member-schedule-repository.js';

function rowToEntry(row: Record<string, unknown>): MemberScheduleEntry {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    dayOfWeek: Number(row.day_of_week) as 1 | 2 | 3 | 4 | 5,
    title: String(row.title),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    confirmed: Boolean(row.confirmed),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresMemberScheduleRepository implements MemberScheduleRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]> {
    const { rows } = await this.pool.query(
      `select * from member_schedule
       where family_id = $1 and member_id = $2
       order by day_of_week, start_time`,
      [familyId, memberId],
    );
    return rows.map(rowToEntry);
  }

  async create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry> {
    const { rows } = await this.pool.query(
      `insert into member_schedule (family_id, member_id, day_of_week, title, start_time, end_time)
       values ($1, $2, $3, $4, $5::time, $6::time)
       returning *`,
      [familyId, memberId, entry.dayOfWeek, entry.title, entry.startTime, entry.endTime],
    );
    return rowToEntry(rows[0]);
  }

  async delete(familyId: string, entryId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `delete from member_schedule where id = $1 and family_id = $2`,
      [entryId, familyId],
    );
    return (rowCount ?? 0) > 0;
  }

  async setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update member_schedule set confirmed = $3 where id = $1 and family_id = $2`,
      [entryId, familyId, confirmed],
    );
    return (rowCount ?? 0) > 0;
  }
}
