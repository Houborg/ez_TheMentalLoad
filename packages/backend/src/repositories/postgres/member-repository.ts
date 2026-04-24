import type { Member } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { MemberRepository } from '../member-repository';

export class PostgresMemberRepository implements MemberRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Member[]> {
    const result = await this.pool.query(
      'select id, name, role, email, avatar, created_at from members order by created_at asc',
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      email: row.email ?? undefined,
      avatar: row.avatar ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async findById(id: string): Promise<Member | undefined> {
    const result = await this.pool.query(
      'select id, name, role, email, avatar, created_at from members where id = $1',
      [id],
    );

    const row = result.rows[0];
    return row
        ? { id: row.id, name: row.name, role: row.role, email: row.email ?? undefined, avatar: row.avatar ?? undefined, createdAt: new Date(row.created_at).toISOString() }
      : undefined;
  }

  async create(member: Member): Promise<Member> {
    await this.pool.query(
      'insert into members (id, name, role, email, avatar, created_at) values ($1, $2, $3, $4, $5, $6)',
      [member.id, member.name, member.role, member.email ?? null, member.avatar ?? null, member.createdAt],
    );

    return member;
  }

  async update(id: string, patch: Partial<Member>): Promise<Member | undefined> {
    const current = await this.findById(id);
    if (!current) {
      return undefined;
    }

    const next: Member = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
    };

    await this.pool.query(
      'update members set name = $2, role = $3, email = $4, avatar = $5 where id = $1',
      [id, next.name, next.role, next.email ?? null, next.avatar ?? null],
    );

    return next;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('delete from members where id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
