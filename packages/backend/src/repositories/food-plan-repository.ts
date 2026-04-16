import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';

export interface FoodPlanRepository {
  listByWeek(weekStart: string): Promise<FoodPlanItem[]>;
  upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string; groceryList: string[] }): Promise<FoodPlanItem>;
  deleteByWeekAndDay(weekStart: string, day: FoodPlanDay): Promise<boolean>;
}

export class InMemoryFoodPlanRepository implements FoodPlanRepository {
  constructor(private readonly items: FoodPlanItem[] = []) {}

  async listByWeek(weekStart: string): Promise<FoodPlanItem[]> {
    return this.items
      .filter((item) => item.weekStart === weekStart)
      .sort((left, right) => left.day.localeCompare(right.day));
  }

  async upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string; groceryList: string[] }): Promise<FoodPlanItem> {
    const existing = this.items.find((item) => item.weekStart === input.weekStart && item.day === input.day);

    if (existing) {
      existing.dishName = input.dishName;
      existing.groceryList = [...input.groceryList];
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const created: FoodPlanItem = {
      id: `${input.weekStart}-${input.day}`,
      weekStart: input.weekStart,
      day: input.day,
      dishName: input.dishName,
      groceryList: [...input.groceryList],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.items.push(created);
    return created;
  }

  async deleteByWeekAndDay(weekStart: string, day: FoodPlanDay): Promise<boolean> {
    const index = this.items.findIndex((item) => item.weekStart === weekStart && item.day === day);
    if (index < 0) {
      return false;
    }

    this.items.splice(index, 1);
    return true;
  }
}
