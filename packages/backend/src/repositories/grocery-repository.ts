import type { GroceryItem, GroceryCategory } from '@mental-load/contracts';

export interface CreateGroceryInput {
  text: string;
  category: GroceryCategory;
  source: 'food_plan' | 'manual';
  foodPlanItemId?: string;
  weekStart?: string;
}

export interface GroceryRepository {
  list(familyId: string, weekStart: string): Promise<GroceryItem[]>;
  create(familyId: string, input: CreateGroceryInput): Promise<GroceryItem>;
  update(familyId: string, id: string, patch: { completed?: boolean; text?: string }): Promise<GroceryItem | undefined>;
  delete(familyId: string, id: string): Promise<boolean>;
  deleteCompleted(familyId: string, weekStart: string): Promise<number>;
}

const CAT_ORDER = ['kød', 'mejeri', 'grønt', 'tørvarer', 'andet'];

export class InMemoryGroceryRepository implements GroceryRepository {
  private rows: Array<GroceryItem & { familyId: string }> = [];

  async list(familyId: string, weekStart: string): Promise<GroceryItem[]> {
    return this.rows
      .filter(r => r.familyId === familyId && r.weekStart === weekStart)
      .sort((a, b) =>
        CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category)
        || a.createdAt.localeCompare(b.createdAt),
      )
      .map(({ familyId: _f, ...rest }) => rest);
  }

  async create(familyId: string, input: CreateGroceryInput): Promise<GroceryItem> {
    const item: GroceryItem & { familyId: string } = {
      id: crypto.randomUUID(),
      familyId,
      text: input.text,
      category: input.category,
      completed: false,
      source: input.source,
      foodPlanItemId: input.foodPlanItemId,
      weekStart: input.weekStart,
      createdAt: new Date().toISOString(),
    };
    this.rows.push(item);
    const { familyId: _f, ...rest } = item;
    return rest;
  }

  async update(familyId: string, id: string, patch: { completed?: boolean; text?: string }): Promise<GroceryItem | undefined> {
    const row = this.rows.find(r => r.id === id && r.familyId === familyId);
    if (!row) return undefined;
    if (patch.completed !== undefined) row.completed = patch.completed;
    if (patch.text !== undefined) row.text = patch.text;
    const { familyId: _f, ...rest } = row;
    return rest;
  }

  async delete(familyId: string, id: string): Promise<boolean> {
    const idx = this.rows.findIndex(r => r.id === id && r.familyId === familyId);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async deleteCompleted(familyId: string, weekStart: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter(r => !(r.familyId === familyId && r.weekStart === weekStart && r.completed));
    return before - this.rows.length;
  }
}
