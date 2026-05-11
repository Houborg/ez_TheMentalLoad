import type { Calendar } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { CalendarRepository } from '../calendar-repository';

export class PostgresCalendarRepository implements CalendarRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId?: string): Promise<Calendar[]> {
    if (!familyId) return [];
    const result = await this.pool.query(
      'select id, name, color, owner_member_id, created_at from calendars where family_id = $1 order by created_at asc',
      [familyId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      ownerMemberId: row.owner_member_id ?? '',
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async findById(id: string, familyId?: string): Promise<Calendar | undefined> {
    if (!familyId) return undefined;
    const result = await this.pool.query(
      'select id, name, color, owner_member_id, created_at from calendars where id = $1 and family_id = $2',
      [id, familyId],
    );

    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          color: row.color,
          ownerMemberId: row.owner_member_id ?? '',
          createdAt: new Date(row.created_at).toISOString(),
        }
      : undefined;
  }

  async create(calendar: Calendar, familyId?: string): Promise<Calendar> {
    if (!familyId) throw new Error('familyId required for create');
    await this.pool.query(
      'insert into calendars (id, name, color, owner_member_id, created_at, family_id) values ($1, $2, $3, $4, $5, $6)',
      // ownerMemberId '' means shared/no-owner — store as NULL in the DB
      [calendar.id, calendar.name, calendar.color, calendar.ownerMemberId || null, calendar.createdAt, familyId],
    );

    return calendar;
  }

  async delete(id: string, familyId?: string): Promise<void> {
    if (!familyId) return;
    await this.pool.query('delete from calendars where id = $1 and family_id = $2', [id, familyId]);
  }
}
