import type { Pool } from 'pg';
import type { GroceryItem, GroceryCategory } from '@mental-load/contracts';
import type { GroceryRepository, CreateGroceryInput } from '../grocery-repository.js';

function rowToItem(row: Record<string, unknown>): GroceryItem {
  return {
    id: String(row.id),
    text: String(row.text),
    category: String(row.category) as GroceryCategory,
    completed: Boolean(row.completed),
    source: String(row.source) as 'food_plan' | 'manual',
    foodPlanItemId: row.food_plan_item_id ? String(row.food_plan_item_id) : undefined,
    weekStart: row.week_start ? String(row.week_start).slice(0, 10) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

const CAT_ORDER = `case category
  when 'kød' then 1 when 'mejeri' then 2 when 'grønt' then 3
  when 'tørvarer' then 4 else 5 end`;

export class PostgresGroceryRepository implements GroceryRepository {
  constructor(private readonly pool: Pool) {}

  async list(familyId: string, weekStart: string): Promise<GroceryItem[]> {
    const { rows } = await this.pool.query(
      `select id, text, category, completed, source, food_plan_item_id, week_start, created_at
       from grocery_items
       where family_id = $1 and week_start = $2
       order by ${CAT_ORDER}, created_at`,
      [familyId, weekStart],
    );
    return rows.map(rowToItem);
  }

  async create(familyId: string, input: CreateGroceryInput): Promise<GroceryItem> {
    const { rows } = await this.pool.query(
      `insert into grocery_items (family_id, text, category, source, food_plan_item_id, week_start)
       values ($1, $2, $3, $4, $5, $6)
       returning id, text, category, completed, source, food_plan_item_id, week_start, created_at`,
      [familyId, input.text, input.category, input.source, input.foodPlanItemId ?? null, input.weekStart ?? null],
    );
    return rowToItem(rows[0]);
  }

  async update(familyId: string, id: string, patch: { completed?: boolean; text?: string }): Promise<GroceryItem | undefined> {
    const sets: string[] = [];
    const vals: unknown[] = [familyId, id];
    if (patch.completed !== undefined) { vals.push(patch.completed); sets.push(`completed = $${vals.length}`); }
    if (patch.text !== undefined) { vals.push(patch.text); sets.push(`text = $${vals.length}`); }
    if (!sets.length) return undefined;
    const { rows } = await this.pool.query(
      `update grocery_items set ${sets.join(', ')} where family_id = $1 and id = $2
       returning id, text, category, completed, source, food_plan_item_id, week_start, created_at`,
      vals,
    );
    return rows[0] ? rowToItem(rows[0]) : undefined;
  }

  async delete(familyId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'delete from grocery_items where family_id = $1 and id = $2',
      [familyId, id],
    );
    return (rowCount ?? 0) > 0;
  }

  async deleteCompleted(familyId: string, weekStart: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      'delete from grocery_items where family_id = $1 and week_start = $2 and completed = true',
      [familyId, weekStart],
    );
    return rowCount ?? 0;
  }
}
