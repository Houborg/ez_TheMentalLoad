import type { Member } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { MemberRepository } from '../member-repository';

export class PostgresMemberRepository implements MemberRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Member[]> {
    const result = await this.pool.query(
      'select id, name, role, created_at from members order by created_at asc',
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async findById(id: string): Promise<Member | undefined> {
    const result = await this.pool.query(
      'select id, name, role, created_at from members where id = $1',
      [id],
    );

    const row = result.rows[0];
    return row
      ? { id: row.id, name: row.name, role: row.role, createdAt: new Date(row.created_at).toISOString() }
      : undefined;
  }

  async create(member: Member): Promise<Member> {
    await this.pool.query(
      'insert into members (id, name, role, created_at) values ($1, $2, $3, $4)',
      [member.id, member.name, member.role, member.createdAt],
    );

    return member;
  }
}
