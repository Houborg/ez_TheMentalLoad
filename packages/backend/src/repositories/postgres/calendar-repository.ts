import type { Calendar } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { CalendarRepository } from '../calendar-repository';

export class PostgresCalendarRepository implements CalendarRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Calendar[]> {
    const result = await this.pool.query(
      'select id, name, color, owner_member_id, created_at from calendars order by created_at asc',
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      ownerMemberId: row.owner_member_id,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async findById(id: string): Promise<Calendar | undefined> {
    const result = await this.pool.query(
      'select id, name, color, owner_member_id, created_at from calendars where id = $1',
      [id],
    );

    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          name: row.name,
          color: row.color,
          ownerMemberId: row.owner_member_id,
          createdAt: new Date(row.created_at).toISOString(),
        }
      : undefined;
  }

  async create(calendar: Calendar): Promise<Calendar> {
    await this.pool.query(
      'insert into calendars (id, name, color, owner_member_id, created_at) values ($1, $2, $3, $4, $5)',
      [calendar.id, calendar.name, calendar.color, calendar.ownerMemberId, calendar.createdAt],
    );

    return calendar;
  }
}
