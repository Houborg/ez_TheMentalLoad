export interface AulaConfirmationRepository {
  /** Returns set of aula_item_ids that are confirmed for this family */
  listConfirmed(familyId: string): Promise<Set<string>>;
  confirm(familyId: string, aulaItemId: string): Promise<void>;
  unconfirm(familyId: string, aulaItemId: string): Promise<void>;
}

export class InMemoryAulaConfirmationRepository implements AulaConfirmationRepository {
  private confirmed: Map<string, Set<string>> = new Map();

  async listConfirmed(familyId: string): Promise<Set<string>> {
    return new Set(this.confirmed.get(familyId) ?? []);
  }

  async confirm(familyId: string, aulaItemId: string): Promise<void> {
    if (!this.confirmed.has(familyId)) this.confirmed.set(familyId, new Set());
    this.confirmed.get(familyId)!.add(aulaItemId);
  }

  async unconfirm(familyId: string, aulaItemId: string): Promise<void> {
    this.confirmed.get(familyId)?.delete(aulaItemId);
  }
}
