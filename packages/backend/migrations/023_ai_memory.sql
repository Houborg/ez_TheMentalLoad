create table if not exists ai_memory (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  member_id   uuid references members(id) on delete cascade,
  category    text not null check (category in ('person','preference','pattern','event')),
  key         text not null,
  value       text not null,
  source      text not null default 'ai' check (source in ('sync','event','chat','ai','user')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_memory_family
  on ai_memory (family_id);

create index if not exists ai_memory_member
  on ai_memory (family_id, member_id) where member_id is not null;

create unique index if not exists ai_memory_family_key_member
  on ai_memory (family_id, key, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid));
