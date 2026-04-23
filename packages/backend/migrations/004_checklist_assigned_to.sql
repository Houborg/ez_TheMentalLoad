alter table entry_checklist_items
  add column if not exists assigned_to_member_id uuid references members(id) on delete set null;
create index if not exists idx_entry_checklist_items_assigned_to_member on entry_checklist_items (assigned_to_member_id);
