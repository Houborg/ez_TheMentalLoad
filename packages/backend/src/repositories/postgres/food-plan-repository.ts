import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { FoodPlanRepository } from '../food-plan-repository';

export class PostgresFoodPlanRepository implements FoodPlanRepository {
  constructor(private readonly pool: Pool) {}

  async listByWeek(weekStart: string): Promise<FoodPlanItem[]> {
    const result = await this.pool.query(
      'select id, week_start, day, dish_name, grocery_list, created_at, updated_at from food_plan_items where week_start = $1 order by day asc',
      [weekStart],
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  async upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string; groceryList: string[] }): Promise<FoodPlanItem> {
    const result = await this.pool.query(
      `insert into food_plan_items (week_start, day, dish_name, grocery_list)
       values ($1, lower($2), $3, $4::jsonb)
       on conflict (week_start, day)
       do update set dish_name = excluded.dish_name, grocery_list = excluded.grocery_list, updated_at = now()
       returning id, week_start, day, dish_name, grocery_list, created_at, updated_at`,
      [input.weekStart, input.day, input.dishName, JSON.stringify(input.groceryList)],
    );

    return this.mapRow(result.rows[0]);
  }

  async deleteByWeekAndDay(weekStart: string, day: FoodPlanDay): Promise<boolean> {
    const result = await this.pool.query('delete from food_plan_items where week_start = $1 and lower(day) = lower($2)', [weekStart, day]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: Record<string, unknown>): FoodPlanItem {
    const weekStartRaw = row.week_start;
    const weekStart = weekStartRaw instanceof Date
      ? weekStartRaw.toISOString().slice(0, 10)
      : String(weekStartRaw).slice(0, 10);

    return {
      id: String(row.id),
      weekStart,
      day: String(row.day).toLowerCase() as FoodPlanDay,
      dishName: String(row.dish_name),
      groceryList: Array.isArray(row.grocery_list)
        ? row.grocery_list.map((value) => String(value))
        : JSON.parse(String(row.grocery_list ?? '[]')).map((value: unknown) => String(value)),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
