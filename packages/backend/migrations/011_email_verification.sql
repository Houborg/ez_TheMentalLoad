-- 011_email_verification.sql
alter table users add column if not exists email_verified boolean not null default false;

create table if not exists verification_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_verification_tokens_hash on verification_tokens (token_hash);

-- Existing users are pre-verified — they existed before this feature
update users set email_verified = true where email_verified = false;
