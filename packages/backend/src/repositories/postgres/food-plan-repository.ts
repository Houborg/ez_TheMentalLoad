import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';
import type { Pool } from 'pg';
import type { FoodPlanRepository } from '../food-plan-repository';

export class PostgresFoodPlanRepository implements FoodPlanRepository {
  constructor(private readonly pool: Pool) {}

  async listByWeek(weekStart: string, familyId?: string): Promise<FoodPlanItem[]> {
    if (!familyId) return [];
    const result = await this.pool.query(
      'select id, week_start, day, dish_name, created_at, updated_at from food_plan_items where week_start = $1 and family_id = $2 order by day asc',
      [weekStart, familyId],
    );

    return result.rows.map((row) => this.mapRow(row));
  }

  async upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string }, familyId?: string): Promise<FoodPlanItem> {
    if (!familyId) throw new Error('familyId required for upsert');
    const result = await this.pool.query(
      `insert into food_plan_items (week_start, day, dish_name, family_id)
       values ($1, lower($2), $3, $4)
       on conflict (family_id, week_start, day)
       do update set dish_name = excluded.dish_name, updated_at = now()
       returning id, week_start, day, dish_name, created_at, updated_at`,
      [input.weekStart, input.day, input.dishName, familyId],
    );

    return this.mapRow(result.rows[0]);
  }

  async deleteByWeekAndDay(weekStart: string, day: FoodPlanDay, familyId?: string): Promise<boolean> {
    if (!familyId) return false;
    const result = await this.pool.query(
      'delete from food_plan_items where week_start = $1 and lower(day) = lower($2) and family_id = $3',
      [weekStart, day, familyId],
    );
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
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }
}
