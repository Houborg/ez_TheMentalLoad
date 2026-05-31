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
ALTER TABLE food_plan_items DROP COLUMN IF EXISTS grocery_list;
