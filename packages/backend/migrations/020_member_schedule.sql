create table if not exists member_schedule (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  member_id    uuid not null references members(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 1 and 5),
  title        text not null,
  start_time   time not null,
  end_time     time not null,
  confirmed    boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists member_schedule_lookup
  on member_schedule (family_id, member_id, day_of_week);
