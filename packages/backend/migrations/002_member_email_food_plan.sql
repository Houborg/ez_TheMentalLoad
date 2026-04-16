alter table members
  add column if not exists email text;

create table if not exists food_plan_items (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  day text not null check (day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  dish_name text not null,
  grocery_list jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, day)
);

create index if not exists idx_food_plan_week_start on food_plan_items (week_start);
