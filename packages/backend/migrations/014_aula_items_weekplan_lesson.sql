-- 014_aula_items_weekplan_lesson.sql
-- Extend the aula_items.type CHECK constraint to allow 'weekplan_lesson'.
-- Replaces the daily_overview data path (item 3 from MentalLoad-Issues).
-- Existing daily_overview rows are left as dead data — item 2 will clear them.

alter table aula_items drop constraint if exists aula_items_type_check;

alter table aula_items add constraint aula_items_type_check
  check (type in ('post', 'message', 'daily_overview', 'weekplan_lesson'));
