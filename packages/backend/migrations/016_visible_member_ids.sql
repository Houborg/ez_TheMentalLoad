alter table entries add column if not exists visible_member_ids jsonb not null default '[]'::jsonb;
