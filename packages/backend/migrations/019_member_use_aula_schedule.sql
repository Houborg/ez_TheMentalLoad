alter table members
  add column if not exists use_aula_schedule boolean not null default true;
