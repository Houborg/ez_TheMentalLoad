create extension if not exists "pgcrypto";

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('parent', 'child')),
  created_at timestamptz not null default now()
);

create table if not exists calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null,
  owner_member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('event', 'task')),
  owner_member_id uuid not null references members(id) on delete cascade,
  calendar_id uuid not null references calendars(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  all_day boolean not null default false,
  location text,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  recurrence_rule text,
  parent_entry_id uuid references entries(id) on delete set null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists entry_reminders (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  minutes_before integer not null,
  created_at timestamptz not null default now()
);

create table if not exists entry_checklist_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  text text not null,
  is_completed boolean not null default false
);

create table if not exists entry_invitees (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined'))
);

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists assistant_configs (
  id uuid primary key default gen_random_uuid(),
  model_name text not null,
  language text not null,
  enabled boolean not null default true
);

create table if not exists sync_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('none', 'apple', 'invite-mail')),
  config_json jsonb not null default '{}'::jsonb,
  is_connected boolean not null default false
);

create index if not exists idx_entries_calendar_start on entries (calendar_id, start_time);
create index if not exists idx_entries_owner on entries (owner_member_id);
create index if not exists idx_entry_reminders_entry on entry_reminders (entry_id);
