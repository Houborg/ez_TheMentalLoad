# Grocery List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proper grocery list — tickable, AI-categorised, sourced from food plan + manual additions — living as a new tab inside the Mad (food) view.

**Architecture:** New `grocery_items` DB table replaces `groceryList: string[]` on food plan items. Backend routes expose CRUD + bulk-clear. Frontend adds a `GroceryList` component rendered in a new "Indkøb" tab inside `MobileFoodPlanner`. Categories assigned by a keyword matcher at insert time — no AI API call needed.

**Tech Stack:** Fastify (backend), Next.js + React (frontend), PostgreSQL, TypeScript, Tailwind v4

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/contracts/src/domain.ts` | Modify | Add `GroceryItem`, `GroceryCategory`; remove `groceryList` from `FoodPlanItem` |
| `packages/contracts/src/api.ts` | Modify | Add `CreateGroceryItemRequest`, `UpdateGroceryItemRequest`; remove `groceryList` from `UpsertFoodPlanItemRequest` |
| `packages/backend/migrations/025_grocery_items.sql` | Create | Create table, backfill, drop column |
| `packages/backend/src/repositories/grocery-repository.ts` | Create | Interface + InMemory implementation |
| `packages/backend/src/repositories/postgres/grocery-repository.ts` | Create | Postgres implementation |
| `packages/backend/src/repositories/repository-factory.ts` | Modify | Add `groceryRepository` to bundle |
| `packages/backend/src/app.ts` | Modify | Add grocery routes; strip `groceryList` from food plan upsert |
| `packages/backend/src/repositories/food-plan-repository.ts` | Modify | Remove `groceryList` from interface + InMemory impl |
| `packages/backend/src/repositories/postgres/food-plan-repository.ts` | Modify | Remove `grocery_list` from SQL queries |
| `packages/frontend/lib/api.ts` | Modify | Add grocery API functions; remove `groceryList` from food plan calls |
| `packages/frontend/components/grocery-list.tsx` | Create | Tickable grocery list component |
| `packages/frontend/components/mobile/mobile-food-planner.tsx` | Modify | Add "Indkøb" tab toggle; remove grocery textarea from editor |
| `packages/backend/src/domains/assistant/tool-executor.ts` | Modify | Update `add_grocery` to call grocery repo instead of food plan |

---

## Task 1: Contracts — add GroceryItem types, remove groceryList

**Files:**
- Modify: `packages/contracts/src/domain.ts`
- Modify: `packages/contracts/src/api.ts`

- [ ] **Step 1: Add GroceryCategory and GroceryItem to domain.ts**

Open `packages/contracts/src/domain.ts`. Find `FoodPlanItem` (around line 230). Add before it:

```typescript
export type GroceryCategory = 'kød' | 'mejeri' | 'grønt' | 'tørvarer' | 'andet';

export interface GroceryItem {
  id: string;
  text: string;
  category: GroceryCategory;
  completed: boolean;
  source: 'food_plan' | 'manual';
  foodPlanItemId?: string;
  weekStart?: string;
  createdAt: string;
}
```

- [ ] **Step 2: Remove groceryList from FoodPlanItem**

In `FoodPlanItem`, remove the line:
```typescript
  groceryList: string[];
```

- [ ] **Step 3: Update api.ts — add grocery request types, remove groceryList**

Open `packages/contracts/src/api.ts`. Find `UpsertFoodPlanItemRequest` (around line 153) and remove:
```typescript
  groceryList?: string[];
```

Also add `GroceryItem` to the import from `'./domain'` at the top of the file.

Add these new interfaces after the food plan section:

```typescript
export interface CreateGroceryItemRequest {
  text: string;
  weekStart?: string;
  foodPlanItemId?: string;
}

export interface UpdateGroceryItemRequest {
  completed?: boolean;
  text?: string;
}

export interface ListGroceryResponse {
  weekStart: string;
  items: GroceryItem[];
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: errors only in backend/frontend files that still reference `groceryList` — that's expected and will be fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/domain.ts packages/contracts/src/api.ts
git commit -m "feat(contracts): add GroceryItem type, remove groceryList from FoodPlanItem"
```

---

## Task 2: Migration

**Files:**
- Create: `packages/backend/migrations/025_grocery_items.sql`

- [ ] **Step 1: Write migration**

```sql
-- 025_grocery_items.sql

CREATE TABLE grocery_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  text              TEXT        NOT NULL,
  category          TEXT        NOT NULL DEFAULT 'andet'
                                CHECK (category IN ('kød','mejeri','grønt','tørvarer','andet')),
  completed         BOOLEAN     NOT NULL DEFAULT FALSE,
  source            TEXT        NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('food_plan','manual')),
  food_plan_item_id UUID        REFERENCES food_plan_items(id) ON DELETE CASCADE,
  week_start        DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON grocery_items (family_id, week_start, completed);

-- Backfill from existing groceryList strings
INSERT INTO grocery_items (family_id, text, category, source, food_plan_item_id, week_start)
SELECT
  fpi.family_id,
  trim(gl.item)         AS text,
  'andet'               AS category,
  'food_plan'           AS source,
  fpi.id                AS food_plan_item_id,
  fpi.week_start        AS week_start
FROM food_plan_items fpi,
     jsonb_array_elements_text(fpi.grocery_list) AS gl(item)
WHERE fpi.grocery_list IS NOT NULL
  AND jsonb_array_length(fpi.grocery_list) > 0;

-- Drop the old column
ALTER TABLE food_plan_items DROP COLUMN grocery_list;
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/migrations/025_grocery_items.sql
git commit -m "feat(db): add grocery_items table, backfill from food_plan_items, drop grocery_list column"
```

---

## Task 3: GroceryRepository — interface + InMemory

**Files:**
- Create: `packages/backend/src/repositories/grocery-repository.ts`

- [ ] **Step 1: Write the repository**

Create `packages/backend/src/repositories/grocery-repository.ts`:

```typescript
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

export class InMemoryGroceryRepository implements GroceryRepository {
  private rows: Array<GroceryItem & { familyId: string }> = [];

  async list(familyId: string, weekStart: string): Promise<GroceryItem[]> {
    return this.rows
      .filter(r => r.familyId === familyId && r.weekStart === weekStart)
      .sort((a, b) => {
        const catOrder = ['kød', 'mejeri', 'grønt', 'tørvarer', 'andet'];
        return catOrder.indexOf(a.category) - catOrder.indexOf(b.category)
          || a.createdAt.localeCompare(b.createdAt);
      })
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/repositories/grocery-repository.ts
git commit -m "feat(backend): add GroceryRepository interface + InMemory implementation"
```

---

## Task 4: Postgres GroceryRepository

**Files:**
- Create: `packages/backend/src/repositories/postgres/grocery-repository.ts`

- [ ] **Step 1: Write Postgres implementation**

Create `packages/backend/src/repositories/postgres/grocery-repository.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/repositories/postgres/grocery-repository.ts
git commit -m "feat(backend): add PostgresGroceryRepository"
```

---

## Task 5: Wire repository into factory + strip groceryList from food plan repo

**Files:**
- Modify: `packages/backend/src/repositories/repository-factory.ts`
- Modify: `packages/backend/src/repositories/food-plan-repository.ts`
- Modify: `packages/backend/src/repositories/postgres/food-plan-repository.ts`

- [ ] **Step 1: Add groceryRepository to RepositoryBundle**

In `packages/backend/src/repositories/repository-factory.ts`:

Add imports near the top (after existing ai imports):
```typescript
import { InMemoryGroceryRepository } from './grocery-repository.js';
import type { GroceryRepository } from './grocery-repository.js';
import { PostgresGroceryRepository } from './postgres/grocery-repository.js';
```

Add to the `RepositoryBundle` interface:
```typescript
  groceryRepository: GroceryRepository;
```

In the Postgres bundle (inside `if (pool)` block, after `aiSuggestionRepository`):
```typescript
        groceryRepository: new PostgresGroceryRepository(pool),
```

In the in-memory bundle (after `aiSuggestionRepository`):
```typescript
    groceryRepository: new InMemoryGroceryRepository(),
```

- [ ] **Step 2: Remove groceryList from food-plan-repository.ts interface**

In `packages/backend/src/repositories/food-plan-repository.ts`, update the `FoodPlanRepository` interface:

```typescript
export interface FoodPlanRepository {
  listByWeek(weekStart: string, familyId?: string): Promise<FoodPlanItem[]>;
  upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string }, familyId?: string): Promise<FoodPlanItem>;
  deleteByWeekAndDay(weekStart: string, day: FoodPlanDay, familyId?: string): Promise<boolean>;
}
```

Update `InMemoryFoodPlanRepository.upsert` signature and body to remove `groceryList`:

```typescript
  async upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string }, _familyId?: string): Promise<FoodPlanItem> {
    const existing = this.items.find((item) => item.weekStart === input.weekStart && item.day === input.day);
    if (existing) {
      existing.dishName = input.dishName;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    const created: FoodPlanItem = {
      id: `${input.weekStart}-${input.day}`,
      weekStart: input.weekStart,
      day: input.day,
      dishName: input.dishName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.items.push(created);
    return created;
  }
```

- [ ] **Step 3: Remove grocery_list from PostgresFoodPlanRepository**

In `packages/backend/src/repositories/postgres/food-plan-repository.ts`:

Update `upsert` signature:
```typescript
  async upsert(input: { weekStart: string; day: FoodPlanDay; dishName: string }, familyId?: string): Promise<FoodPlanItem> {
```

Update the SQL query:
```typescript
    const result = await this.pool.query(
      `insert into food_plan_items (week_start, day, dish_name, family_id)
       values ($1, lower($2), $3, $4)
       on conflict (family_id, week_start, day)
       do update set dish_name = excluded.dish_name, updated_at = now()
       returning id, week_start, day, dish_name, created_at, updated_at`,
      [input.weekStart, input.day, input.dishName, familyId],
    );
```

Update `listByWeek` query to remove `grocery_list`:
```typescript
      'select id, week_start, day, dish_name, created_at, updated_at from food_plan_items where week_start = $1 and family_id = $2 order by day asc',
```

Update `mapRow` to remove `groceryList`:
```typescript
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
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: errors only in `app.ts` (still references `groceryList`) — fixed next task.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/repositories/repository-factory.ts \
        packages/backend/src/repositories/food-plan-repository.ts \
        packages/backend/src/repositories/postgres/food-plan-repository.ts
git commit -m "feat(backend): wire grocery repo, strip groceryList from food plan repo"
```

---

## Task 6: Backend routes — grocery CRUD + fix food plan upsert

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Add category helper near the top of app.ts**

Find the imports section at the top of `packages/backend/src/app.ts`. After the existing imports, add:

```typescript
import type { GroceryRepository } from './repositories/grocery-repository.js';
import type { GroceryCategory } from '@mental-load/contracts';

const GROCERY_CATEGORY_RULES: Array<{ pattern: RegExp; category: GroceryCategory }> = [
  { pattern: /oksekød|kylling|laks|fisk|bacon|pølse|kød|bøf|hakket/i, category: 'kød' },
  { pattern: /mælk|ost|smør|fløde|yoghurt|æg|parmesan|mejeri|creme/i, category: 'mejeri' },
  { pattern: /tomat|løg|gulerod|salat|broccoli|grønt|frugt|æble|banan|kartof|peber|spinat|kål/i, category: 'grønt' },
  { pattern: /pasta|ris|mel|olie|dåse|konserves|lasagne|nudl|tørvare|brød|sukker|salt/i, category: 'tørvarer' },
];

function categoriseGrocery(text: string): GroceryCategory {
  for (const rule of GROCERY_CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return 'andet';
}
```

- [ ] **Step 2: Add groceryRepository to svc() return**

In the `getRequestServices` function (around line 204), the return statement includes repos. Add after `aiSuggestionRepository`:

```typescript
groceryRepository: infrastructure.groceryRepository,
```

(The full return at line ~261 — add `groceryRepository: infrastructure.groceryRepository` to it.)

- [ ] **Step 3: Fix food plan upsert route to drop groceryList**

Find the food plan PUT route (around line 816). Replace its body with:

```typescript
  app.put<{ Body: UpsertFoodPlanItemRequest }>('/api/v1/food-plan', async (request, reply) => {
    const weekStart = normalizeWeekStart(request.body.weekStart);
    if (!weekStart || !isFoodPlanDay(request.body.day)) {
      reply.code(400);
      return { message: 'Invalid weekStart or day' };
    }
    const dishName = request.body.dishName?.trim();
    if (!dishName) {
      reply.code(400);
      return { message: 'dishName is required' };
    }
    const item = await svc(request).foodPlanRepository.upsert({ weekStart, day: request.body.day, dishName });
    return item;
  });
```

- [ ] **Step 4: Add grocery routes after the AI memory section**

Find the end of the AI memory routes (around line 1030) in `app.ts`. Add after them:

```typescript
  // ── Grocery List ──────────────────────────────────────────────────────────────

  app.get<{ Querystring: { weekStart?: string } }>('/api/v1/grocery', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (request as any).familyId as string;
    const weekStart = normalizeWeekStart(request.query.weekStart);
    if (!weekStart) { reply.code(400); return { message: 'weekStart required' }; }
    const items = await svc(request).groceryRepository.list(familyId, weekStart);
    return { weekStart, items };
  });

  app.post<{ Body: { text: string; weekStart?: string; foodPlanItemId?: string } }>('/api/v1/grocery', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (request as any).familyId as string;
    const text = request.body.text?.trim();
    if (!text) { reply.code(400); return { message: 'text required' }; }
    const weekStart = normalizeWeekStart(request.body.weekStart);
    const item = await svc(request).groceryRepository.create(familyId, {
      text,
      category: categoriseGrocery(text),
      source: request.body.foodPlanItemId ? 'food_plan' : 'manual',
      foodPlanItemId: request.body.foodPlanItemId,
      weekStart: weekStart ?? undefined,
    });
    reply.code(201);
    return item;
  });

  app.patch<{ Params: { id: string }; Body: { completed?: boolean; text?: string } }>('/api/v1/grocery/:id', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (request as any).familyId as string;
    const updated = await svc(request).groceryRepository.update(familyId, request.params.id, request.body);
    if (!updated) { reply.code(404); return { message: 'Item not found' }; }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/api/v1/grocery/:id', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (request as any).familyId as string;
    const ok = await svc(request).groceryRepository.delete(familyId, request.params.id);
    if (!ok) { reply.code(404); return { message: 'Item not found' }; }
    reply.code(204);
  });

  app.delete<{ Querystring: { weekStart?: string } }>('/api/v1/grocery/completed', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const familyId = (request as any).familyId as string;
    const weekStart = normalizeWeekStart(request.query.weekStart);
    if (!weekStart) { reply.code(400); return { message: 'weekStart required' }; }
    const deleted = await svc(request).groceryRepository.deleteCompleted(familyId, weekStart);
    return { deleted };
  });
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors in backend. Frontend errors remain (fixed next).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat(backend): add grocery CRUD routes, categoriser, fix food plan upsert"
```

---

## Task 7: Frontend API functions

**Files:**
- Modify: `packages/frontend/lib/api.ts`

- [ ] **Step 1: Add GroceryItem import**

At the top of `packages/frontend/lib/api.ts`, find the import from `@mental-load/contracts` and add `GroceryItem`, `ListGroceryResponse`, `CreateGroceryItemRequest`, `UpdateGroceryItemRequest` to the list.

- [ ] **Step 2: Fix updateFoodPlan to drop groceryList**

Find `updateFoodPlan` (around line 189). The payload type is `UpsertFoodPlanItemRequest` — since we removed `groceryList` from that interface in Task 1, this will now typecheck without `groceryList`. No body change needed unless existing callers pass `groceryList` — fix those in Task 9.

- [ ] **Step 3: Add grocery API functions at the end of the file**

```typescript
// ── Grocery ──────────────────────────────────────────────────────────────────

export async function loadGroceryList(weekStart: string): Promise<ListGroceryResponse> {
  return fetchJson<ListGroceryResponse>(`/api/v1/grocery?weekStart=${weekStart}`);
}

export async function createGroceryItem(input: CreateGroceryItemRequest): Promise<GroceryItem> {
  return fetchJson<GroceryItem>('/api/v1/grocery', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateGroceryItem(id: string, patch: UpdateGroceryItemRequest): Promise<GroceryItem> {
  return fetchJson<GroceryItem>(`/api/v1/grocery/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteGroceryItem(id: string): Promise<void> {
  await fetchJson<void>(`/api/v1/grocery/${id}`, { method: 'DELETE' });
}

export async function clearCompletedGroceries(weekStart: string): Promise<{ deleted: number }> {
  return fetchJson<{ deleted: number }>(
    `/api/v1/grocery/completed?weekStart=${weekStart}`,
    { method: 'DELETE' },
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/lib/api.ts
git commit -m "feat(frontend): add grocery API functions, remove groceryList from food plan API"
```

---

## Task 8: GroceryList component

**Files:**
- Create: `packages/frontend/components/grocery-list.tsx`

- [ ] **Step 1: Create the component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GroceryItem } from '@mental-load/contracts';
import {
  loadGroceryList,
  createGroceryItem,
  updateGroceryItem,
  deleteGroceryItem,
  clearCompletedGroceries,
} from '@/lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  kød: '🥩 Kød',
  mejeri: '🥛 Mejeri',
  grønt: '🥦 Grønt',
  tørvarer: '🧂 Tørvarer',
  andet: '🛒 Andet',
};

const CATEGORY_ORDER = ['kød', 'mejeri', 'grønt', 'tørvarer', 'andet'];

interface Props {
  weekStart: string;
}

export function GroceryList({ weekStart }: Props) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);

  useEffect(() => {
    loadGroceryList(weekStart).then(r => setItems(r.items)).catch(console.error);
  }, [weekStart]);

  const active = items.filter(i => !i.completed);
  const done = items.filter(i => i.completed);

  // Group active items by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, GroceryItem[]>>((acc, cat) => {
    const catItems = active.filter(i => i.category === cat);
    if (catItems.length > 0) acc[cat] = catItems;
    return acc;
  }, {});

  async function handleTick(item: GroceryItem) {
    // Optimistic update
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i));
    try {
      await updateGroceryItem(item.id, { completed: !item.completed });
    } catch {
      // Revert on error
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: item.completed } : i));
    }
  }

  async function handleDelete(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    try {
      await deleteGroceryItem(id);
    } catch {
      // Silently ignore — item already removed from UI
    }
  }

  async function handleAdd() {
    const text = addText.trim();
    if (!text) return;
    setAdding(true);
    setAddText('');
    try {
      const created = await createGroceryItem({ text, weekStart });
      setItems(prev => [...prev, created]);
    } finally {
      setAdding(false);
    }
  }

  async function handleClearDone() {
    setItems(prev => prev.filter(i => !i.completed));
    await clearCompletedGroceries(weekStart).catch(console.error);
  }

  return (
    <div className="flex flex-col gap-1 pb-24">
      {/* Active items grouped by category */}
      {Object.entries(grouped).map(([cat, catItems]) => (
        <div key={cat}>
          <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABELS[cat]}
          </div>
          {catItems.map(item => (
            <GroceryRow key={item.id} item={item} onTick={handleTick} onDelete={handleDelete} />
          ))}
        </div>
      ))}

      {active.length === 0 && done.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50 text-sm">
          <span className="text-3xl mb-3">🛒</span>
          <p>Ingen varer på listen</p>
          <p className="text-xs mt-1">Tilføj varer fra madplanen eller manuelt</p>
        </div>
      )}

      {/* Add item row */}
      <div className="px-4 mt-2">
        {showAddInput ? (
          <div className="flex gap-2 items-center">
            <input
              autoFocus
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); if (e.key === 'Escape') setShowAddInput(false); }}
              placeholder="Tilføj vare…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              disabled={adding}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding || !addText.trim()}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {adding ? '…' : 'Tilføj'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddInput(true)}
            className="flex items-center gap-2 w-full rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tilføj vare…
          </button>
        )}
      </div>

      {/* I kurven section */}
      {done.length > 0 && (
        <div className="mx-4 mt-4 rounded-xl border border-border/40 bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              ✓ I kurven ({done.length})
            </span>
            <button
              type="button"
              onClick={() => void handleClearDone()}
              className="flex items-center gap-1 text-xs text-destructive font-semibold"
            >
              <Trash2 className="h-3 w-3" />
              Ryd alle
            </button>
          </div>
          {done.map(item => (
            <div key={item.id} className="flex items-center gap-3 py-2 border-t border-border/30">
              <button
                type="button"
                onClick={() => void handleTick(item)}
                className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
              >
                <span className="text-primary-foreground text-[10px]">✓</span>
              </button>
              <span className="text-sm line-through text-muted-foreground/60 flex-1">{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  item: GroceryItem;
  onTick: (item: GroceryItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function GroceryRow({ item, onTick, onDelete }: RowProps) {
  const sourceLine = item.source === 'food_plan'
    ? item.foodPlanItemId
      ? undefined  // could show dish name if needed
      : undefined
    : 'Ekstra';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-0">
      <button
        type="button"
        onClick={() => void onTick(item)}
        className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0 hover:border-primary transition-colors"
        aria-label={`Marker ${item.text}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{item.text}</div>
        {item.source === 'manual' && (
          <div className="text-[10px] text-muted-foreground/50">Ekstra</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onDelete(item.id)}
        className="text-muted-foreground/30 hover:text-destructive transition-colors p-1"
        aria-label={`Slet ${item.text}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/grocery-list.tsx
git commit -m "feat(frontend): add GroceryList component"
```

---

## Task 9: Update MobileFoodPlanner — add Indkøb tab, remove grocery textarea

**Files:**
- Modify: `packages/frontend/components/mobile/mobile-food-planner.tsx`

- [ ] **Step 1: Rewrite MobileFoodPlanner**

Replace the entire content of `packages/frontend/components/mobile/mobile-food-planner.tsx` with:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';
import { loadFoodPlan, updateFoodPlan, deleteFoodPlan } from '@/lib/api';
import { GroceryList } from '@/components/grocery-list';
import { MONTHS_DA } from '@/lib/calendar-utils';
import { BottomSheet } from './bottom-sheet';

const DAYS_DA_FULL = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const FOOD_PLAN_DAYS: FoodPlanDay[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

function toWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

type Tab = 'madplan' | 'indkøb';

export function MobileFoodPlanner() {
  const [tab, setTab] = useState<Tab>('madplan');
  const [weekStart, setWeekStart] = useState(() => toWeekStart(new Date()));
  const [items, setItems] = useState<FoodPlanItem[]>([]);
  const [editDay, setEditDay] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFoodPlan(weekStart).then(r => setItems(r.items)).catch(console.error);
  }, [weekStart]);

  const weekStartDate = new Date(weekStart + 'T00:00:00Z');
  const weekEndDate = addDays(weekStartDate, 6);
  const weekLabel = `${weekStartDate.getUTCDate()}. ${MONTHS_DA[weekStartDate.getUTCMonth()]} – ${weekEndDate.getUTCDate()}. ${MONTHS_DA[weekEndDate.getUTCMonth()]}`;

  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function itemForDay(dayIndex: number): FoodPlanItem | undefined {
    return items.find(i => i.day === FOOD_PLAN_DAYS[dayIndex]);
  }

  function openEdit(dayIndex: number) {
    const item = itemForDay(dayIndex);
    setEditDay(dayIndex);
    setEditText(item?.dishName ?? '');
  }

  async function saveEdit() {
    if (editDay === null) return;
    const day = FOOD_PLAN_DAYS[editDay];
    setSaving(true);
    try {
      if (editText.trim()) {
        await updateFoodPlan({ weekStart, day, dishName: editText.trim() });
        setItems(prev => {
          const filtered = prev.filter(i => i.day !== day);
          const existing = prev.find(i => i.day === day);
          const now = new Date().toISOString();
          const newItem: FoodPlanItem = {
            id: existing?.id ?? '',
            weekStart,
            day,
            dishName: editText.trim(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          return [...filtered, newItem];
        });
      }
      setEditDay(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (editDay === null) return;
    const day = FOOD_PLAN_DAYS[editDay];
    setSaving(true);
    try {
      await deleteFoodPlan({ weekStart, day });
      setItems(prev => prev.filter(i => i.day !== day));
      setEditDay(null);
    } finally {
      setSaving(false);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold">Mad</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={prevWeek}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground px-1">{weekLabel}</span>
          <button type="button" onClick={nextWeek}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border mx-4 mt-3">
        <button
          type="button"
          onClick={() => setTab('madplan')}
          className={`flex-1 pb-2 text-sm font-semibold transition-colors ${
            tab === 'madplan'
              ? 'border-b-2 border-primary text-primary -mb-px'
              : 'text-muted-foreground'
          }`}
        >
          Madplan
        </button>
        <button
          type="button"
          onClick={() => setTab('indkøb')}
          className={`flex-1 pb-2 text-sm font-semibold transition-colors ${
            tab === 'indkøb'
              ? 'border-b-2 border-primary text-primary -mb-px'
              : 'text-muted-foreground'
          }`}
        >
          🛒 Indkøb
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'madplan' && (
          <div className="pb-20 px-4 flex flex-col gap-2 mt-3">
            {DAYS_DA_FULL.map((dayName, i) => {
              const item = itemForDay(i);
              const date = addDays(weekStartDate, i);
              const dateStr = date.toISOString().slice(0, 10);
              const isToday = dateStr === todayStr;
              return (
                <button
                  key={FOOD_PLAN_DAYS[i]}
                  type="button"
                  onClick={() => openEdit(i)}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-left w-full"
                >
                  <div>
                    <div className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                      {dayName}{isToday && <span className="ml-2 text-xs font-normal">i dag</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {date.getUTCDate()}. {MONTHS_DA[date.getUTCMonth()]}
                    </div>
                  </div>
                  <div className="text-sm text-right max-w-[55%]">
                    {item
                      ? <div className="truncate">{item.dishName}</div>
                      : <span className="text-muted-foreground/50">Ingen plan</span>
                    }
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'indkøb' && (
          <GroceryList weekStart={weekStart} />
        )}
      </div>

      {/* Edit bottom sheet (Madplan only) */}
      <BottomSheet open={editDay !== null} onClose={() => setEditDay(null)} ariaLabelledby="food-edit-title">
        <div className="px-4 pb-8 pt-2">
          <h2 id="food-edit-title" className="font-semibold mb-3">
            {editDay !== null ? DAYS_DA_FULL[editDay] : ''}
          </h2>
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void saveEdit()}
            placeholder="Hvad skal vi spise?"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
          />
          <div className="flex gap-2">
            <button type="button" onClick={saveEdit} disabled={saving}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            {editDay !== null && itemForDay(editDay) && (
              <button type="button" onClick={handleDelete} disabled={saving}
                className="flex items-center gap-1 rounded-xl border border-border px-4 py-3 text-sm text-destructive disabled:opacity-50">
                <X className="h-4 w-4" /> Slet
              </button>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-food-planner.tsx
git commit -m "feat(frontend): add Indkøb tab to MobileFoodPlanner, remove grocery textarea"
```

---

## Task 10: Update ToolExecutor for add_grocery

**Files:**
- Modify: `packages/backend/src/domains/assistant/tool-executor.ts`

- [ ] **Step 1: Update ToolExecutorDeps and add_grocery case**

In `packages/backend/src/domains/assistant/tool-executor.ts`, add `addGroceryItems` to `ToolExecutorDeps`:

```typescript
export interface ToolExecutorDeps {
  createEntry: (input: CreateEntryRequest) => Promise<{ id: string }>;
  upsertFoodPlan: (input: { weekStart: string; day: FoodPlanDay; dishName: string }) => Promise<unknown>;
  getDefaultMemberCalendar: () => Promise<{ memberId: string; calendarId: string } | null>;
  addGroceryItems: (items: string[], weekStart: string) => Promise<void>;
}
```

Replace the `add_grocery` case:

```typescript
      case 'add_grocery': {
        const d = suggestion.actionData as { items?: string[]; weekStart?: string };
        const items = Array.isArray(d.items) ? d.items.filter(Boolean) : [];
        if (!items.length) throw new Error('No items for add_grocery');
        const weekStart = d.weekStart ?? getThisMonday();
        await deps.addGroceryItems(items, weekStart);
        result = { ok: true, message: `${items.length} varer tilføjet til indkøbsliste` };
        break;
      }
```

- [ ] **Step 2: Wire addGroceryItems in app.ts execute route**

In `packages/backend/src/app.ts`, find the `executeSuggestion` call (around line 977). Add `addGroceryItems` to the deps:

```typescript
        addGroceryItems: async (items, weekStart) => {
          const { groceryRepository } = svc(request);
          for (const text of items) {
            await groceryRepository.create(familyId, {
              text,
              category: categoriseGrocery(text),
              source: 'manual',
              weekStart,
            });
          }
        },
```

- [ ] **Step 3: Remove old upsertFoodPlan usage in add_grocery (if still there)**

Also update `upsertFoodPlan` in deps to remove `groceryList` from the type:

```typescript
        upsertFoodPlan: (input) => scopedRepo.foodPlanRepository.upsert(input),
```

(The food plan upsert no longer takes `groceryList`, so this just passes `{ weekStart, day, dishName }`.)

- [ ] **Step 4: Typecheck and fix any remaining errors**

```bash
npm run typecheck
```

Fix any remaining type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/domains/assistant/tool-executor.ts packages/backend/src/app.ts
git commit -m "feat(backend): update add_grocery action to write grocery_items rows"
```

---

## Task 11: Run tests

- [ ] **Step 1: Run integration tests**

```bash
npm run test:integration
```

Expected: all tests pass. If food plan tests fail because they pass `groceryList`, update the test payloads to remove it.

- [ ] **Step 2: Fix any failing tests**

If `app.test.ts` has food plan tests that include `groceryList`, remove `groceryList` from those test payloads.

- [ ] **Step 3: Commit any test fixes**

```bash
git add packages/backend/src/app.test.ts
git commit -m "fix(tests): remove groceryList from food plan test payloads"
```

---

## Task 12: Deploy

- [ ] **Step 1: Push to remote**

```bash
git push
```

- [ ] **Step 2: Pull and rebuild on production**

```bash
ssh mhouborg@192.168.1.252 "git -C ~/testbench/TestBench/data/apps/mentalload/source pull && docker compose -p mentalload -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml up -d --build backend frontend"
```

- [ ] **Step 3: Verify**

Open https://mentalload.pl0k.online → Mad tab → should see "Madplan" and "Indkøb" tabs. Indkøb tab should load (empty for new weeks, or items if food plan had groceries before).
