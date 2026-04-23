alter table entries
  add column if not exists assigned_to_member_id uuid references members(id) on delete set null;

create index if not exists idx_entries_assigned_to_member on entries (assigned_to_member_id);
