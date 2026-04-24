alter table daily_timeline_templates
  add column if not exists is_milestone boolean not null default false;

alter table daily_timeline_templates
  add column if not exists reward_text text;

alter table daily_timeline_tasks
  add column if not exists is_milestone boolean not null default false;

alter table daily_timeline_tasks
  add column if not exists reward_text text;
