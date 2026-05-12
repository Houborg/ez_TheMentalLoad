-- 010_family_settings.sql
alter table families add column if not exists settings_json jsonb not null default '{}'::jsonb;
