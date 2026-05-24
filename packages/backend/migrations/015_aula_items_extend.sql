-- 015_aula_items_extend.sql
-- Extend aula_items for items 2 (dismiss), 5 (mu_task), 6 (presence).
-- Adds hidden_at soft-hide column + 2 new types + per-member-per-type index.

alter table aula_items drop constraint if exists aula_items_type_check;
alter table aula_items add constraint aula_items_type_check
  check (type in ('post','message','daily_overview','weekplan_lesson','mu_task','presence'));

alter table aula_items add column if not exists hidden_at timestamptz;

create index if not exists idx_aula_items_member_type_pub
  on aula_items(family_id, member_id, type, published_at desc);
