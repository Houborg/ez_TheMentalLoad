import type { Member } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { MemberRepository } from '../member-repository';

export class PostgresMemberRepository implements MemberRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId?: string): Promise<Member[]> {
    if (!familyId) return [];
    const result = await this.pool.query(
      'select id, name, role, email, avatar, color, created_at from members where family_id = $1 order by created_at asc',
      [familyId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      email: row.email ?? undefined,
      avatar: row.avatar ?? undefined,
      color: row.color ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async findById(id: string, familyId?: string): Promise<Member | undefined> {
    if (!familyId) return undefined;
    const result = await this.pool.query(
      'select id, name, role, email, avatar, color, created_at from members where id = $1 and family_id = $2',
      [id, familyId],
    );

    const row = result.rows[0];
    return row
      ? { id: row.id, name: row.name, role: row.role, email: row.email ?? undefined, avatar: row.avatar ?? undefined, color: row.color ?? undefined, createdAt: new Date(row.created_at).toISOString() }
      : undefined;
  }

  async create(member: Member, familyId?: string): Promise<Member> {
    if (!familyId) throw new Error('familyId required for create');
    await this.pool.query(
      'insert into members (id, name, role, email, avatar, color, created_at, family_id) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [member.id, member.name, member.role, member.email ?? null, member.avatar ?? null, member.color ?? null, member.createdAt, familyId],
    );

    return member;
  }

  async update(id: string, patch: Partial<Member>, familyId?: string): Promise<Member | undefined> {
    if (!familyId) return undefined;
    const current = await this.findById(id, familyId);
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
      'update members set name = $2, role = $3, email = $4, avatar = $5, color = $6 where id = $1 and family_id = $7',
      [id, next.name, next.role, next.email ?? null, next.avatar ?? null, next.color ?? null, familyId],
    );

    return next;
  }

  async delete(id: string, familyId?: string): Promise<boolean> {
    if (!familyId) return false;
    const result = await this.pool.query(
      'delete from members where id = $1 and family_id = $2',
      [id, familyId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
