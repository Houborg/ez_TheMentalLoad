alter table entries
  add column if not exists aula_item_id uuid references aula_items(id) on delete set null;

create index if not exists entries_aula_item_id
  on entries (aula_item_id) where aula_item_id is not null;
