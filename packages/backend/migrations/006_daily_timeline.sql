create table if not exists member_timeline_settings (
  member_id uuid primary key references members(id) on delete cascade,
  enabled boolean not null default false,
  max_tasks_per_day integer not null default 10 check (max_tasks_per_day > 0 and max_tasks_per_day <= 50),
  updated_at timestamptz not null default now()
);

create table if not exists daily_timeline_templates (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  expected_time time,
  is_active boolean not null default true,
  applies_to_entry_task boolean not null default true,
  applies_to_event_derived_task boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, position)
);

create table if not exists daily_timeline_days (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  day_date date not null,
  timezone text not null,
  reset_at timestamptz,
  blocked_by_task_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, day_date)
);

create table if not exists daily_timeline_tasks (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references daily_timeline_days(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  title text not null,
  position integer not null check (position > 0),
  source text not null check (source in ('template', 'one_off', 'entry_task', 'event_derived_task')),
  status text not null check (status in ('pending', 'waiting_confirmation', 'completed', 'skipped')),
  due_at timestamptz,
  confirmed_at timestamptz,
  linked_entry_id uuid references entries(id) on delete set null,
  template_task_id uuid references daily_timeline_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, position)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_daily_timeline_days_blocked_task'
  ) then
    alter table daily_timeline_days
      add constraint fk_daily_timeline_days_blocked_task
      foreign key (blocked_by_task_id) references daily_timeline_tasks(id) on delete set null;
  end if;
end
$$;

create table if not exists daily_timeline_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references daily_timeline_tasks(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email')),
  kind text not null check (kind in ('step_reached', 'step_completed')),
  recipient_member_id uuid not null references members(id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (task_id, channel, kind, recipient_member_id)
);

create index if not exists idx_member_timeline_settings_enabled on member_timeline_settings (enabled);
create index if not exists idx_daily_timeline_templates_member on daily_timeline_templates (member_id, position);
create index if not exists idx_daily_timeline_days_member_date on daily_timeline_days (member_id, day_date);
create index if not exists idx_daily_timeline_tasks_day_status on daily_timeline_tasks (day_id, status);
create index if not exists idx_daily_timeline_tasks_member_due on daily_timeline_tasks (member_id, due_at);
create index if not exists idx_daily_timeline_notifications_recipient on daily_timeline_notifications (recipient_member_id, sent_at desc);
