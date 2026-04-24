import type { Member } from '@mental-load/contracts';

export interface MemberRepository {
  list(): Promise<Member[]>;
  findById(id: string): Promise<Member | undefined>;
  create(member: Member): Promise<Member>;
  update(id: string, patch: Partial<Member>): Promise<Member | undefined>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryMemberRepository implements MemberRepository {
  constructor(private readonly members: Member[] = []) {}

  async list(): Promise<Member[]> {
    return [...this.members];
  }

  async findById(id: string): Promise<Member | undefined> {
    return this.members.find((member) => member.id === id);
  }

  async create(member: Member): Promise<Member> {
    this.members.push(member);
    return member;
  }

  async update(id: string, patch: Partial<Member>): Promise<Member | undefined> {
    const current = this.members.find((member) => member.id === id);
    if (!current) {
      return undefined;
    }

    Object.assign(current, patch);
    return current;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.members.findIndex((member) => member.id === id);
    if (index < 0) {
      return false;
    }

    this.members.splice(index, 1);
    return true;
  }
}
