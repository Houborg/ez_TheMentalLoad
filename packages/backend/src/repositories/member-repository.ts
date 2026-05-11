import type { Member } from '@mental-load/contracts';

export interface MemberRepository {
  list(familyId?: string): Promise<Member[]>;
  findById(id: string, familyId?: string): Promise<Member | undefined>;
  create(member: Member, familyId?: string): Promise<Member>;
  update(id: string, patch: Partial<Member>, familyId?: string): Promise<Member | undefined>;
  delete(id: string, familyId?: string): Promise<boolean>;
}

export class InMemoryMemberRepository implements MemberRepository {
  constructor(private readonly members: Member[] = []) {}

  async list(_familyId?: string): Promise<Member[]> {
    return [...this.members];
  }

  async findById(id: string, _familyId?: string): Promise<Member | undefined> {
    return this.members.find((member) => member.id === id);
  }

  async create(member: Member, _familyId?: string): Promise<Member> {
    this.members.push(member);
    return member;
  }

  async update(id: string, patch: Partial<Member>, _familyId?: string): Promise<Member | undefined> {
    const current = this.members.find((member) => member.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch);
    return current;
  }

  async delete(id: string, _familyId?: string): Promise<boolean> {
    const index = this.members.findIndex((member) => member.id === id);
    if (index < 0) {
      return false;
    }

    this.members.splice(index, 1);
    return true;
  }
}
