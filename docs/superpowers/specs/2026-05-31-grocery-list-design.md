# Grocery List — Design Spec

**Date:** 2026-05-31
**Status:** Approved
**Scope:** Dedicated grocery list inside the Mad tab — tickable, categorised, sourced from food plan and manual additions

---

## 1. Goal

Give the family a proper shopping list that lives alongside the food plan, is usable in-store on mobile, and forms a clean DB foundation for future grocery features (shared lists, AI suggestions, store routing, etc.).

---

## 2. Data Model

### Remove `groceryList: string[]` from `food_plan_items`

The existing `groceryList` column on `food_plan_items` is replaced by FK rows in `grocery_items`. Migration drops the column after backfilling.

### New table: `grocery_items`

```sql
CREATE TABLE grocery_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  text              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'andet',
    -- 'kød' | 'mejeri' | 'grønt' | 'tørvarer' | 'andet'
  completed         BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT NOT NULL DEFAULT 'manual',
    -- 'food_plan' | 'manual'
  food_plan_item_id UUID REFERENCES food_plan_items(id) ON DELETE CASCADE,
  week_start        DATE,           -- ISO Monday date, for weekly scope
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON grocery_items (family_id, week_start, completed);
```

### `FoodPlanItem` contract change

Remove `groceryList: string[]` from the `FoodPlanItem` interface in `contracts/src/domain.ts`. Replace with nothing — grocery items are fetched separately via the grocery endpoints.

Also remove `groceryList?: string[]` from `UpsertFoodPlanItemRequest` in `contracts/src/api.ts`.

---

## 3. Category Assignment

Categories are assigned by a lightweight keyword matcher in the backend (no AI API call needed — deterministic, instant, free):

```typescript
const CATEGORY_RULES: Array<{ pattern: RegExp; category: GroceryCategory }> = [
  { pattern: /oksekød|kylling|laks|fisk|bacon|pølse|kød|bøf|hakket/i, category: 'kød' },
  { pattern: /mælk|ost|smør|fløde|yoghurt|æg|parmesan|mejeri/i,        category: 'mejeri' },
  { pattern: /tomat|løg|gulerod|salat|broccoli|grønt|frugt|æble|banan/i, category: 'grønt' },
  { pattern: /pasta|ris|mel|olie|dåse|konserves|lasagne|nudl|tørvare/i, category: 'tørvarer' },
];

function categorise(text: string): GroceryCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return 'andet';
}
```

Category is assigned at insert time. It is stored in the DB and can be corrected later (future feature).

---

## 4. Migration

**File:** `migrations/025_grocery_items.sql`

```sql
-- 1. Create grocery_items table
CREATE TABLE grocery_items ( ... );  -- as above

-- 2. Backfill existing groceryList data into grocery_items
INSERT INTO grocery_items (family_id, text, category, source, food_plan_item_id, week_start)
SELECT
  fp.family_id,
  unnest(fpi.grocery_list) AS text,
  'andet'                  AS category,
  'food_plan'              AS source,
  fpi.id                   AS food_plan_item_id,
  fpi.week_start           AS week_start
FROM food_plan_items fpi
JOIN food_plans fp ON fp.id = fpi.food_plan_id
WHERE array_length(fpi.grocery_list, 1) > 0;

-- 3. Drop groceryList column
ALTER TABLE food_plan_items DROP COLUMN grocery_list;
```

---

## 5. Backend

### New routes (added to `app.ts`)

```
GET    /api/v1/grocery?weekStart=YYYY-MM-DD
  → list all grocery_items for family + week, ordered by category, created_at

POST   /api/v1/grocery
  body: { text, weekStart?, foodPlanItemId? }
  → insert row; auto-assigns category; returns created item

PATCH  /api/v1/grocery/:id
  body: { completed?: boolean, text?: string }
  → update tick state or text

DELETE /api/v1/grocery/:id
  → delete item (manual items only; food plan items deleted via food plan)

DELETE /api/v1/grocery/completed?weekStart=YYYY-MM-DD
  → bulk-delete all completed items for a week ("Ryd alle")
```

### Updated food plan upsert

`POST /api/v1/food-plan` no longer accepts `groceryList`. Instead, separate `POST /api/v1/grocery` calls are used to add items to a food plan day. The food plan editor sends these calls automatically when the user types an ingredient.

### Repositories

- `GroceryRepository` interface + `InMemoryGroceryRepository` + `PostgresGroceryRepository`
- Methods: `list(familyId, weekStart)`, `create(familyId, input)`, `update(familyId, id, patch)`, `delete(familyId, id)`, `deleteCompleted(familyId, weekStart)`

---

## 6. Frontend

### New component: `GroceryList`
`packages/frontend/components/grocery-list.tsx`

Props:
```typescript
interface Props {
  weekStart: string;  // ISO Monday
}
```

Fetches `GET /api/v1/grocery?weekStart=...` on mount and after mutations.

**Rendering:**
- Items grouped by category: Kød → Mejeri → Grønt → Tørvarer → Andet
- Each item row: circle checkbox · text · source label (dish + day, or "Ekstra")
- Tick: optimistic update → PATCH completed=true → item fades + moves to "I kurven" section
- "I kurven (N)" collapsed section at bottom with "Ryd alle" button
- "+ Tilføj vare…" row at bottom of active list → inline text input → POST on Enter

### Modified: `MobileFoodView` (or equivalent food tab component)

Add a tab bar at the top: **Madplan** | **Indkøb**

- Madplan tab: existing food plan week view (unchanged except ingredient editor)
- Indkøb tab: `<GroceryList weekStart={currentWeekStart} />`

Both tabs share the same week navigator (prev/next week arrows + "Uge NN" label).

### Modified: food plan day editor

When editing a food plan day's ingredients, the editor calls `POST /api/v1/grocery` (with `foodPlanItemId`) instead of updating `groceryList: string[]`. On delete of an ingredient, calls `DELETE /api/v1/grocery/:id`.

### `lib/api.ts` additions

```typescript
getGroceryList(weekStart: string): Promise<GroceryItem[]>
createGroceryItem(input: CreateGroceryItemRequest): Promise<GroceryItem>
updateGroceryItem(id: string, patch: { completed?: boolean; text?: string }): Promise<GroceryItem>
deleteGroceryItem(id: string): Promise<void>
clearCompletedGroceries(weekStart: string): Promise<void>
```

---

## 7. Contracts

### New types (`domain.ts`)

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

### Removed from `domain.ts`
- `groceryList: string[]` on `FoodPlanItem`

### New request types (`api.ts`)

```typescript
export interface CreateGroceryItemRequest {
  text: string;
  weekStart?: string;
  foodPlanItemId?: string;
}
```

### Removed from `api.ts`
- `groceryList?: string[]` on `UpsertFoodPlanItemRequest`

---

## 8. AI Integration

- `add_grocery` suggestion action in `ToolExecutor` updated to call `POST /api/v1/grocery` instead of updating food plan items
- `buildAiContext` updated: food plan section shows dish names per day; grocery items shown as a separate `INDKØBSLISTE` section listing uncompleted items for the current week

---

## 9. Out of Scope

- Category editing by user (stored in DB, editable later)
- Sharing grocery list with external apps
- Store-aisle ordering
- Recurring manual items ("always buy milk")
- Push notification when list is empty
