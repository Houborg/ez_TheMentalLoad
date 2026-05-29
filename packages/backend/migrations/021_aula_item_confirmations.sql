create table if not exists aula_item_confirmations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  aula_item_id uuid not null references aula_items(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  unique (family_id, aula_item_id)
);
