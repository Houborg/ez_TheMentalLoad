create table if not exists ai_suggestions (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('morning','event','sync','manual')),
  trigger_ref  text,
  category     text not null check (category in ('task','food','calendar','grocery','info')),
  text         text not null,
  action_type  text not null check (action_type in ('add_event','add_task','update_food','add_grocery','set_reminder','info')),
  action_data  jsonb not null default '{}',
  status       text not null default 'pending'
                 check (status in ('pending','confirmed','executing','done','dismissed','expired')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days'
);

create index if not exists ai_suggestions_family_status
  on ai_suggestions (family_id, status, created_at desc);
