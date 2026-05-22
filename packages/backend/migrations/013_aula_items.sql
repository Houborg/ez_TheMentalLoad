-- 013_aula_items.sql
-- Stores non-calendar Aula data: posts, messages, daily overviews.
-- Calendar events go directly into the entries table via externalUid dedup.

create table if not exists aula_items (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  aula_id      text not null,
  type         text not null check (type in ('post', 'message', 'daily_overview')),
  title        text,
  body         text,
  author       text,
  member_id    uuid references members(id) on delete set null,
  published_at timestamptz,
  raw_json     jsonb,
  created_at   timestamptz not null default now(),
  unique(family_id, aula_id, type)
);

create index if not exists idx_aula_items_family
  on aula_items(family_id);

create index if not exists idx_aula_items_published
  on aula_items(family_id, published_at desc);
