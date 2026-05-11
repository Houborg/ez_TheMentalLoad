-- 009_multi_family_auth.sql

-- Auth tables
create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  family_id     uuid not null references families(id) on delete cascade,
  role          text not null default 'admin' check (role in ('admin', 'member')),
  created_at    timestamptz not null default now()
);

create table if not exists reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_users_email on users (email);
create index if not exists idx_reset_tokens_hash on reset_tokens (token_hash);

-- Add family_id to data tables (nullable first for backfill)
alter table members         add column if not exists family_id uuid references families(id) on delete cascade;
alter table calendars       add column if not exists family_id uuid references families(id) on delete cascade;
alter table entries         add column if not exists family_id uuid references families(id) on delete cascade;
alter table food_plan_items add column if not exists family_id uuid references families(id) on delete cascade;

-- Insert default family for existing data (idempotent — fixed UUID)
do $$
declare
  default_family_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into families (id, name) values (default_family_id, 'Default Family')
    on conflict (id) do nothing;

  update members         set family_id = default_family_id where family_id is null;
  update calendars       set family_id = default_family_id where family_id is null;
  update entries         set family_id = default_family_id where family_id is null;
  update food_plan_items set family_id = default_family_id where family_id is null;
end $$;

-- Enforce not null now that all rows are backfilled
alter table members         alter column family_id set not null;
alter table calendars       alter column family_id set not null;
alter table entries         alter column family_id set not null;
alter table food_plan_items alter column family_id set not null;

-- Replace single-family unique constraint with family-scoped one
alter table food_plan_items drop constraint if exists food_plan_items_week_start_day_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'food_plan_items_family_week_day_key'
  ) then
    alter table food_plan_items
      add constraint food_plan_items_family_week_day_key unique (family_id, week_start, day);
  end if;
end $$;

create index if not exists idx_members_family     on members         (family_id);
create index if not exists idx_calendars_family   on calendars       (family_id);
create index if not exists idx_entries_family     on entries         (family_id);
create index if not exists idx_food_plan_family   on food_plan_items (family_id);
