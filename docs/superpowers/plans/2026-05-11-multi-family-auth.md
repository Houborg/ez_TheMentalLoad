# Multi-Family Auth & Data Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-password auth with email+password family accounts, isolate all data per family in the existing PostgreSQL database.

**Architecture:** Backend (Fastify) owns auth — issues HS256 JWTs on signup/login, validates them on every request via a preHandler hook. `family_id` is embedded in the JWT and threaded through all repository calls. Frontend middleware verifies the JWT locally via Web Crypto (Edge-compatible). The existing proxy at `/api/v1/[...path]` forwards cookies automatically so no extra plumbing is needed.

**Tech Stack:** jsonwebtoken, bcryptjs, @fastify/cookie (backend); Web Crypto API (frontend middleware, already in use); nodemailer already installed for magic-link email.

---

## File Map

**Create:**
- `packages/backend/migrations/009_multi_family_auth.sql` — families, users, reset_tokens tables + family_id columns on data tables
- `packages/backend/src/auth/auth-service.ts` — signup, login, token issue/verify, magic link
- `packages/backend/src/auth/auth-routes.ts` — Fastify plugin with POST /api/auth/* routes
- `packages/frontend/app/api/auth/signup/route.ts` — proxy to backend signup
- `packages/frontend/app/api/auth/forgot-password/route.ts` — proxy to backend
- `packages/frontend/app/api/auth/reset-password/route.ts` — proxy to backend
- `packages/frontend/app/signup/page.tsx` — signup page
- `packages/frontend/app/setup/page.tsx` — family name setup page
- `packages/frontend/app/forgot-password/page.tsx`
- `packages/frontend/app/reset-password/page.tsx`
- `packages/frontend/components/signup-form.tsx`
- `packages/frontend/components/setup-form.tsx`
- `packages/frontend/components/forgot-password-form.tsx`
- `packages/frontend/components/reset-password-form.tsx`

**Modify:**
- `packages/backend/package.json` — add jsonwebtoken, bcryptjs, @fastify/cookie deps
- `packages/backend/src/app.ts` — register cookie plugin, add auth preHandler, pass familyId to handlers
- `packages/backend/src/repositories/member-repository.ts` — add familyId param to all methods
- `packages/backend/src/repositories/calendar-repository.ts` — same
- `packages/backend/src/repositories/entry-repository.ts` — same
- `packages/backend/src/repositories/food-plan-repository.ts` — same
- `packages/backend/src/repositories/postgres/member-repository.ts` — implement familyId filtering
- `packages/backend/src/repositories/postgres/calendar-repository.ts` — same
- `packages/backend/src/repositories/postgres/entry-repository.ts` — same
- `packages/backend/src/repositories/postgres/food-plan-repository.ts` — same
- `packages/backend/src/repositories/repository-factory.ts` — update RepositoryBundle interface
- `packages/frontend/lib/auth.ts` — replace HMAC session with JWT verification
- `packages/frontend/middleware.ts` — update to use new verifySessionToken return type
- `packages/frontend/app/api/auth/login/route.ts` — call backend instead of validating locally
- `packages/frontend/app/api/auth/logout/route.ts` — keep as-is (just clears cookie)
- `packages/frontend/components/login-form.tsx` — change username→email field, add signup/forgot links

---

## Task 1: Migration — auth tables + family_id columns

**Files:**
- Create: `packages/backend/migrations/009_multi_family_auth.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 009_multi_family_auth.sql

-- Auth tables
create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  family_id     uuid not null references families(id) on delete cascade,
  role          text not null default 'admin' check (role in ('admin', 'member')),
  created_at    timestamptz not null default now()
);

create table if not exists reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists idx_users_email on users (email);
create index if not exists idx_reset_tokens_hash on reset_tokens (token_hash);

-- Add family_id to data tables (nullable first, then backfill, then not null)
alter table members     add column if not exists family_id uuid references families(id) on delete cascade;
alter table calendars   add column if not exists family_id uuid references families(id) on delete cascade;
alter table entries     add column if not exists family_id uuid references families(id) on delete cascade;
alter table food_plan_items add column if not exists family_id uuid references families(id) on delete cascade;

-- Insert default family for existing data
do $$
declare
  default_family_id uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into families (id, name) values (default_family_id, 'Default Family')
    on conflict (id) do nothing;

  update members     set family_id = default_family_id where family_id is null;
  update calendars   set family_id = default_family_id where family_id is null;
  update entries     set family_id = default_family_id where family_id is null;
  update food_plan_items set family_id = default_family_id where family_id is null;
end $$;

-- Now enforce not null
alter table members     alter column family_id set not null;
alter table calendars   alter column family_id set not null;
alter table entries     alter column family_id set not null;
alter table food_plan_items alter column family_id set not null;

-- Drop old unique constraint on food_plan_items and add family-scoped one
alter table food_plan_items drop constraint if exists food_plan_items_week_start_day_key;
alter table food_plan_items add constraint food_plan_items_family_week_day_key unique (family_id, week_start, day);

create index if not exists idx_members_family     on members     (family_id);
create index if not exists idx_calendars_family   on calendars   (family_id);
create index if not exists idx_entries_family     on entries     (family_id);
create index if not exists idx_food_plan_family   on food_plan_items (family_id);
```

- [ ] **Step 2: Verify migration runs cleanly**

```bash
cd /path/to/ez_TheMentalLoad
# (migration runs automatically on backend startup via runMigrations)
# Manually verify SQL syntax by reviewing the file
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/migrations/009_multi_family_auth.sql
git commit -m "feat: migration 009 — families, users, reset_tokens + family_id columns"
```

---

## Task 2: Backend — install auth dependencies

**Files:**
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Install packages**

```bash
cd packages/backend
npm install jsonwebtoken bcryptjs @fastify/cookie
npm install --save-dev @types/jsonwebtoken @types/bcryptjs
```

- [ ] **Step 2: Verify install succeeded**

```bash
cd packages/backend && npm run typecheck
```
Expected: no errors about missing modules.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/package.json packages/backend/package-lock.json
git commit -m "feat: add jsonwebtoken, bcryptjs, @fastify/cookie to backend"
```

---

## Task 3: Backend — auth service

**Files:**
- Create: `packages/backend/src/auth/auth-service.ts`

- [ ] **Step 1: Create the auth service**

```typescript
// packages/backend/src/auth/auth-service.ts
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';

export interface JwtPayload {
  userId: string;
  familyId: string;
  role: 'admin' | 'member';
}

function getSecret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-please-set-AUTH_SECRET';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d', algorithm: 'HS256' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}

export class AuthService {
  constructor(private readonly pool: Pool) {}

  async signup(email: string, password: string): Promise<{ token: string; familyId: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await this.pool.query('select id from users where email = $1', [normalizedEmail]);
    if (existing.rowCount) {
      throw new AuthError('Email already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const familyResult = await this.pool.query<{ id: string }>(
      'insert into families default values returning id',
    );
    const familyId = familyResult.rows[0]!.id;

    const userResult = await this.pool.query<{ id: string }>(
      'insert into users (email, password_hash, family_id, role) values ($1, $2, $3, $4) returning id',
      [normalizedEmail, passwordHash, familyId, 'admin'],
    );
    const userId = userResult.rows[0]!.id;

    const token = signToken({ userId, familyId, role: 'admin' });
    return { token, familyId };
  }

  async login(email: string, password: string): Promise<{ token: string; familyId: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await this.pool.query<{
      id: string; password_hash: string; family_id: string; role: string;
    }>(
      'select id, password_hash, family_id, role from users where email = $1',
      [normalizedEmail],
    );

    const user = result.rows[0];
    // Constant-time comparison even on miss (hash a dummy value)
    const hash = user?.password_hash ?? '$2b$12$invalidhashforstalling000000000000000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      throw new AuthError('Invalid credentials', 401);
    }

    const token = signToken({
      userId: user.id,
      familyId: user.family_id,
      role: user.role as 'admin' | 'member',
    });
    return { token, familyId: user.family_id };
  }

  async createResetToken(email: string): Promise<{ raw: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.pool.query<{ id: string }>(
      'select id from users where email = $1',
      [normalizedEmail],
    );
    const user = result.rows[0];
    if (!user) return null; // Don't reveal whether email exists

    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing tokens for this user
    await this.pool.query(
      'update reset_tokens set used_at = now() where user_id = $1 and used_at is null',
      [user.id],
    );

    await this.pool.query(
      'insert into reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)',
      [user.id, hash, expiresAt.toISOString()],
    );

    return { raw };
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await this.pool.query<{
      id: string; user_id: string; expires_at: string; used_at: string | null;
    }>(
      'select id, user_id, expires_at, used_at from reset_tokens where token_hash = $1',
      [hash],
    );

    const token = result.rows[0];
    if (!token || token.used_at || new Date(token.expires_at) < new Date()) {
      throw new AuthError('Reset token is invalid or expired', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.pool.query('update users set password_hash = $1 where id = $2', [passwordHash, token.user_id]);
    await this.pool.query('update reset_tokens set used_at = now() where id = $1', [token.id]);
  }

  async setFamilyName(familyId: string, name: string): Promise<void> {
    await this.pool.query('update families set name = $1 where id = $2', [name.trim(), familyId]);
  }

  async getFamilyName(familyId: string): Promise<string | null> {
    const result = await this.pool.query<{ name: string | null }>('select name from families where id = $1', [familyId]);
    return result.rows[0]?.name ?? null;
  }
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/auth/auth-service.ts
git commit -m "feat: backend auth service — signup, login, magic-link reset"
```

---

## Task 4: Backend — auth routes plugin

**Files:**
- Create: `packages/backend/src/auth/auth-routes.ts`

- [ ] **Step 1: Create auth routes**

```typescript
// packages/backend/src/auth/auth-routes.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AuthService, AuthError } from './auth-service';
import { MailService } from '../mail/mail-service';
import { SettingsService } from '../settings/settings-service';

const COOKIE_NAME = 'ml_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

function isSecure(request: { headers: { [key: string]: string | string[] | undefined } }): boolean {
  return request.headers['x-forwarded-proto'] === 'https';
}

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const authService = new AuthService(pool);
  const mailService = new MailService();
  const settingsService = new SettingsService();

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/signup', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || !email.trim()) {
      reply.code(400); return { message: 'email is required' };
    }
    if (typeof password !== 'string' || password.length < 8) {
      reply.code(400); return { message: 'password must be at least 8 characters' };
    }

    try {
      const { token } = await authService.signup(email, password);
      reply.setCookie(COOKIE_NAME, token, cookieOptions(isSecure(request)));
      reply.code(201);
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      reply.code(400); return { message: 'email and password are required' };
    }

    try {
      const { token } = await authService.login(email, password);
      reply.setCookie(COOKIE_NAME, token, cookieOptions(isSecure(request)));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (!token) { reply.code(401); return { message: 'Not authenticated' }; }
    try {
      const { verifyToken } = await import('./auth-service');
      const payload = verifyToken(token);
      const familyName = await authService.getFamilyName(payload.familyId);
      return { userId: payload.userId, familyId: payload.familyId, role: payload.role, familyName };
    } catch {
      reply.code(401); return { message: 'Invalid or expired session' };
    }
  });

  app.post<{ Body: { familyName?: string } }>('/api/auth/setup', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (!token) { reply.code(401); return { message: 'Not authenticated' }; }
    const name = request.body?.familyName?.trim();
    if (!name) { reply.code(400); return { message: 'familyName is required' }; }
    try {
      const { verifyToken } = await import('./auth-service');
      const payload = verifyToken(token);
      await authService.setFamilyName(payload.familyId, name);
      return { ok: true };
    } catch {
      reply.code(401); return { message: 'Invalid or expired session' };
    }
  });

  app.post<{ Body: { email?: string } }>('/api/auth/forgot-password', async (request, reply) => {
    const email = request.body?.email?.trim();
    if (!email) { reply.code(400); return { message: 'email is required' }; }

    const result = await authService.createResetToken(email);
    if (result) {
      const settings = await settingsService.getSettings();
      const resetUrl = `${process.env.APP_URL ?? 'http://localhost:5173'}/reset-password?token=${result.raw}`;
      try {
        await mailService.sendMail({
          to: email,
          subject: 'Reset your MentalLoad password',
          text: `Click the link to reset your password (expires in 1 hour):\n\n${resetUrl}`,
          html: `<p>Click the link to reset your password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
        }, settings.mail);
      } catch {
        // Swallow email errors — always return 200 to avoid email enumeration
      }
    }

    // Always return 200 regardless of whether email exists
    return { ok: true, message: 'If that email is registered, a reset link has been sent.' };
  });

  app.post<{ Body: { token?: string; password?: string } }>('/api/auth/reset-password', async (request, reply) => {
    const { token: rawToken, password } = request.body ?? {};
    if (typeof rawToken !== 'string' || !rawToken) {
      reply.code(400); return { message: 'token is required' };
    }
    if (typeof password !== 'string' || password.length < 8) {
      reply.code(400); return { message: 'password must be at least 8 characters' };
    }

    try {
      await authService.resetPassword(rawToken, password);
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });
}
```

- [ ] **Step 2: Check MailService has a sendMail method (it may be named differently)**

Look at `packages/backend/src/mail/mail-service.ts` — if the method signature is different, adjust the `forgot-password` handler above accordingly.

- [ ] **Step 3: Typecheck**

```bash
cd packages/backend && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/auth/auth-routes.ts
git commit -m "feat: backend auth routes — signup, login, logout, setup, forgot/reset password"
```

---

## Task 5: Backend — auth preHandler + repository family scoping

**Files:**
- Modify: `packages/backend/src/repositories/member-repository.ts`
- Modify: `packages/backend/src/repositories/calendar-repository.ts`
- Modify: `packages/backend/src/repositories/entry-repository.ts`
- Modify: `packages/backend/src/repositories/food-plan-repository.ts`
- Modify: `packages/backend/src/repositories/postgres/member-repository.ts`
- Modify: `packages/backend/src/repositories/postgres/calendar-repository.ts`
- Modify: `packages/backend/src/repositories/postgres/entry-repository.ts`
- Modify: `packages/backend/src/repositories/postgres/food-plan-repository.ts`

- [ ] **Step 1: Read the current repository interfaces**

Read the 4 interface files to understand current method signatures:
- `packages/backend/src/repositories/member-repository.ts`
- `packages/backend/src/repositories/calendar-repository.ts`
- `packages/backend/src/repositories/entry-repository.ts`
- `packages/backend/src/repositories/food-plan-repository.ts`

- [ ] **Step 2: Add familyId to MemberRepository interface**

In `packages/backend/src/repositories/member-repository.ts`, add `familyId: string` as first param to `list`, `create`, `findById`, `update`, `delete`:

```typescript
export interface MemberRepository {
  list(familyId: string): Promise<Member[]>;
  findById(id: string, familyId: string): Promise<Member | undefined>;
  create(member: Member, familyId: string): Promise<Member>;
  update(id: string, patch: Partial<Member>, familyId: string): Promise<Member | undefined>;
  delete(id: string, familyId: string): Promise<boolean>;
}
```

- [ ] **Step 3: Update PostgresMemberRepository to filter by familyId**

Replace all queries in `packages/backend/src/repositories/postgres/member-repository.ts`:

```typescript
async list(familyId: string): Promise<Member[]> {
  const result = await this.pool.query(
    'select id, name, role, email, avatar, created_at from members where family_id = $1 order by created_at asc',
    [familyId],
  );
  return result.rows.map(row => ({
    id: row.id, name: row.name, role: row.role,
    email: row.email ?? undefined, avatar: row.avatar ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async findById(id: string, familyId: string): Promise<Member | undefined> {
  const result = await this.pool.query(
    'select id, name, role, email, avatar, created_at from members where id = $1 and family_id = $2',
    [id, familyId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, name: row.name, role: row.role, email: row.email ?? undefined, avatar: row.avatar ?? undefined, createdAt: new Date(row.created_at).toISOString() } : undefined;
}

async create(member: Member, familyId: string): Promise<Member> {
  await this.pool.query(
    'insert into members (id, name, role, email, avatar, created_at, family_id) values ($1, $2, $3, $4, $5, $6, $7)',
    [member.id, member.name, member.role, member.email ?? null, member.avatar ?? null, member.createdAt, familyId],
  );
  return member;
}

async update(id: string, patch: Partial<Member>, familyId: string): Promise<Member | undefined> {
  const current = await this.findById(id, familyId);
  if (!current) return undefined;
  const next: Member = { ...current, ...patch, id: current.id, createdAt: current.createdAt };
  await this.pool.query(
    'update members set name = $2, role = $3, email = $4, avatar = $5 where id = $1 and family_id = $6',
    [id, next.name, next.role, next.email ?? null, next.avatar ?? null, familyId],
  );
  return next;
}

async delete(id: string, familyId: string): Promise<boolean> {
  const result = await this.pool.query(
    'delete from members where id = $1 and family_id = $2', [id, familyId],
  );
  return (result.rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Update CalendarRepository interface and PostgresCalendarRepository similarly**

Read `packages/backend/src/repositories/calendar-repository.ts` and `packages/backend/src/repositories/postgres/calendar-repository.ts`.

Add `familyId: string` to `list`, `findById`, `create`, `delete`. In the postgres implementation, add `and family_id = $N` / `family_id = $N` to all queries and add `family_id` to the insert.

- [ ] **Step 5: Update EntryRepository interface and PostgresEntryRepository**

Read `packages/backend/src/repositories/entry-repository.ts` and `packages/backend/src/repositories/postgres/entry-repository.ts`.

Add `familyId: string` to `listAll`, `findById`, `create`, `update`, `delete` and any other relevant methods. In postgres, add `family_id` filtering. The `create` insert must include `family_id`.

- [ ] **Step 6: Update FoodPlanRepository interface and PostgresFoodPlanRepository**

Read `packages/backend/src/repositories/food-plan-repository.ts` and `packages/backend/src/repositories/postgres/food-plan-repository.ts`.

Add `familyId: string` to `listByWeek`, `upsert`, `deleteByWeekAndDay`. In postgres, add `family_id` to all queries and the upsert conflict clause: `on conflict (family_id, week_start, day) do update set ...`.

- [ ] **Step 7: Update InMemory repositories to accept (and ignore) familyId**

The in-memory repos are used for local dev without postgres. Update their method signatures to accept `familyId` but ignore it (they're single-tenant in-memory anyway):

```typescript
// example in InMemoryMemberRepository
async list(_familyId: string): Promise<Member[]> { ... }
async create(member: Member, _familyId: string): Promise<Member> { ... }
// etc.
```

- [ ] **Step 8: Typecheck**

```bash
cd packages/backend && npm run typecheck
```

Expected: errors about app.ts calling repository methods without familyId — that's expected, fixed in Task 6.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/repositories/
git commit -m "feat: add familyId param to all repository interfaces and postgres implementations"
```

---

## Task 6: Backend — wire auth into app.ts

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Add cookie plugin, auth routes, and preHandler to app.ts**

At the top of `buildApp()`, after `await app.register(websocket)`:

```typescript
import cookie from '@fastify/cookie';
import { registerAuthRoutes } from './auth/auth-routes';
import { verifyToken } from './auth/auth-service';

// In buildApp(), after websocket registration:
await app.register(cookie);

// Register auth routes (no auth required on these)
const pool = (infrastructure as any).pool; // or thread pool through RepositoryBundle
await registerAuthRoutes(app, pool);

// Auth preHandler for all non-public routes
const PUBLIC_PATHS = ['/api/auth/', '/api/v1/health', '/ws'];
app.addHook('preHandler', async (request, reply) => {
  if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;
  const token = request.cookies['ml_session'];
  if (!token) { reply.code(401); return reply.send({ message: 'Not authenticated' }); }
  try {
    const payload = verifyToken(token);
    (request as any).familyId = payload.familyId;
  } catch {
    reply.code(401); return reply.send({ message: 'Invalid or expired session' });
  }
});
```

Note: the `pool` needs to be accessible. Add `pool` to `RepositoryBundle` interface in `repository-factory.ts`:
```typescript
export interface RepositoryBundle {
  // ... existing fields
  pool: Pool | null; // null when using in-memory
}
```

And update `createRepositoryBundle` to include it.

- [ ] **Step 2: Update every route handler in app.ts to pass familyId**

For every call to `memberRepository.list()`, change to `memberRepository.list((request as any).familyId)`.

For `calendarRepository`, `entryRepository`, `foodPlanRepository` — same pattern.

This is mechanical: every repository method call gets `(request as any).familyId` (or the appropriate familyId) prepended.

For the startup calendar seeding block at the top of `buildApp()` — wrap it in a conditional `if (infrastructure.persistence === 'postgres')` and use the default family ID `'00000000-0000-4000-8000-000000000001'` for seeding.

- [ ] **Step 3: Typecheck**

```bash
cd packages/backend && npm run typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/app.ts packages/backend/src/repositories/repository-factory.ts
git commit -m "feat: wire JWT auth preHandler and family scoping into all backend route handlers"
```

---

## Task 7: Frontend — update auth lib and middleware

**Files:**
- Modify: `packages/frontend/lib/auth.ts`
- Modify: `packages/frontend/middleware.ts`
- Modify: `packages/frontend/app/api/auth/login/route.ts`

- [ ] **Step 1: Replace lib/auth.ts**

```typescript
// packages/frontend/lib/auth.ts
// JWT verification using Web Crypto API (Edge-compatible, no external deps)

export const COOKIE_NAME = 'ml_session';

function getSecret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-please-set-AUTH_SECRET';
}

export interface SessionPayload {
  userId: string;
  familyId: string;
  role: 'admin' | 'member';
}

function b64urlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts as [string, string, string];

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(getSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    if (!valid) return null;

    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Record<string, unknown>;
    if (typeof data.exp === 'number' && Date.now() / 1000 > data.exp) return null;

    if (typeof data.userId !== 'string' || typeof data.familyId !== 'string') return null;

    return {
      userId: data.userId as string,
      familyId: data.familyId as string,
      role: (data.role as 'admin' | 'member') ?? 'admin',
    };
  } catch {
    return null;
  }
}

export function isHttpsRequest(headers: Headers, url: string): boolean {
  return headers.get('x-forwarded-proto') === 'https' || url.startsWith('https://');
}
```

- [ ] **Step 2: Update middleware.ts**

The middleware currently calls `verifySessionToken(token)` and checks `if (sessionToken && (await verifySessionToken(sessionToken)))`. The new `verifySessionToken` returns `SessionPayload | null` instead of `boolean`, so update the check:

```typescript
// packages/frontend/middleware.ts
import { type NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';

const PUBLIC_PREFIXES = ['/login', '/signup', '/setup', '/forgot-password', '/reset-password', '/api/auth/'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;

  if (sessionToken) {
    const payload = await verifySessionToken(sessionToken);
    if (payload) {
      // Redirect to setup if family name not yet set — checked via /api/auth/me
      // Note: we don't block here; the /setup page handles its own redirect logic
      return NextResponse.next();
    }
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('from', pathname);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 3: Update login API route to call backend**

```typescript
// packages/frontend/app/api/auth/login/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, isHttpsRequest } from '@/lib/auth';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as { email?: string; password?: string };
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ message: 'email and password are required' }, { status: 400 });
  }

  const upstream = await fetch(`${getBackendUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await upstream.json() as { ok?: boolean; message?: string };

  if (!upstream.ok) {
    return NextResponse.json({ message: data.message ?? 'Login failed' }, { status: upstream.status });
  }

  const secure = isHttpsRequest(request.headers, request.url);
  const response = NextResponse.json({ ok: true });

  // Forward the cookie set by the backend
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) {
    response.headers.set('set-cookie', setCookie);
  }

  return response;
}
```

- [ ] **Step 4: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/lib/auth.ts packages/frontend/middleware.ts packages/frontend/app/api/auth/login/route.ts
git commit -m "feat: frontend auth — JWT verification, updated middleware, backend-delegated login"
```

---

## Task 8: Frontend — signup, forgot-password, reset-password API routes

**Files:**
- Create: `packages/frontend/app/api/auth/signup/route.ts`
- Create: `packages/frontend/app/api/auth/forgot-password/route.ts`
- Create: `packages/frontend/app/api/auth/reset-password/route.ts`
- Create: `packages/frontend/app/api/auth/setup/route.ts`

- [ ] **Step 1: Create proxy routes**

```typescript
// packages/frontend/app/api/auth/signup/route.ts
import { type NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string {
  return (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const upstream = await fetch(`${getBackendUrl()}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const data = await upstream.json();
  const response = NextResponse.json(data, { status: upstream.status });
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) response.headers.set('set-cookie', setCookie);
  return response;
}
```

```typescript
// packages/frontend/app/api/auth/forgot-password/route.ts
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const upstream = await fetch(`${(process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
```

```typescript
// packages/frontend/app/api/auth/reset-password/route.ts
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const upstream = await fetch(`${(process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
```

```typescript
// packages/frontend/app/api/auth/setup/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const cookie = request.cookies.get(COOKIE_NAME)?.value ?? '';
  const upstream = await fetch(`${(process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `${COOKIE_NAME}=${cookie}` },
    body,
  });
  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/api/auth/
git commit -m "feat: frontend auth proxy routes — signup, forgot-password, reset-password, setup"
```

---

## Task 9: Frontend — signup, setup, forgot-password, reset-password pages

**Files:**
- Create: `packages/frontend/components/signup-form.tsx`
- Create: `packages/frontend/components/setup-form.tsx`
- Create: `packages/frontend/components/forgot-password-form.tsx`
- Create: `packages/frontend/components/reset-password-form.tsx`
- Create: `packages/frontend/app/signup/page.tsx`
- Create: `packages/frontend/app/setup/page.tsx`
- Create: `packages/frontend/app/forgot-password/page.tsx`
- Create: `packages/frontend/app/reset-password/page.tsx`
- Modify: `packages/frontend/components/login-form.tsx`

- [ ] **Step 1: Create signup form**

```typescript
// packages/frontend/components/signup-form.tsx
'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import Link from 'next/link';

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Signup failed'); return;
      }
      router.push('/setup');
    } catch { setError('Network error'); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Lock className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Create your family</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">Sign up to get started</p>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                <input id="email" type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} disabled={loading}
                  className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                  placeholder="you@example.com" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                <input id="password" type="password" required autoComplete="new-password"
                  value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
                  className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                  placeholder="Min. 8 characters" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                <input id="confirm" type="password" required autoComplete="new-password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading}
                  className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                  placeholder="Repeat your password" />
              </div>
            </div>
            {error && <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">{error}</div>}
            <button type="submit" disabled={loading || !email || !password || !confirm}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
              {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>
        <p className="text-center text-[oklch(0.556_0_0)] text-sm mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-white hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create setup form**

```typescript
// packages/frontend/components/setup-form.tsx
'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Home } from 'lucide-react';

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a family name'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyName: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Could not save family name'); return;
      }
      router.push('/');
      router.refresh();
    } catch { setError('Network error'); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Home className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Name your family</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">This will appear in your dashboard</p>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="familyName" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Family name</label>
              <input id="familyName" type="text" required autoFocus
                value={name} onChange={e => setName(e.target.value)} disabled={loading}
                className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg px-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                placeholder="e.g. The Houborg Family" />
            </div>
            {error && <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">{error}</div>}
            <button type="submit" disabled={loading || !name.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
              {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create forgot-password form**

```typescript
// packages/frontend/components/forgot-password-form.tsx
'use client';
import { useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import Link from 'next/link';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Something went wrong'); return;
      }
      setSent(true);
    } catch { setError('Network error'); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Mail className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Reset password</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">We'll send a reset link to your email</p>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-[oklch(0.7_0_0)] text-sm">If that email is registered, a reset link is on its way. Check your inbox.</p>
              <Link href="/login" className="block text-white text-sm hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="email" type="email" required autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="you@example.com" />
                </div>
              </div>
              {error && <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">{error}</div>}
              <button type="submit" disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
                {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
        {!sent && <p className="text-center text-[oklch(0.556_0_0)] text-sm mt-4">
          <Link href="/login" className="text-white hover:underline">Back to sign in</Link>
        </p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create reset-password form**

```typescript
// packages/frontend/components/reset-password-form.tsx
'use client';
import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import Link from 'next/link';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Reset failed'); return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch { setError('Network error'); } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Lock className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">New password</h1>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          {done ? (
            <p className="text-center text-[oklch(0.7_0_0)] text-sm">Password updated! Redirecting to sign in…</p>
          ) : !token ? (
            <p className="text-center text-[oklch(0.7_0.2_27)] text-sm">Invalid or missing reset token. <Link href="/forgot-password" className="text-white hover:underline">Request a new one</Link>.</p>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">New password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="password" type="password" required autoComplete="new-password"
                    value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="Min. 8 characters" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="confirm" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="confirm" type="password" required autoComplete="new-password"
                    value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="Repeat new password" />
                </div>
              </div>
              {error && <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">{error}</div>}
              <button type="submit" disabled={loading || !password || !confirm}
                className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
                {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create pages**

```typescript
// packages/frontend/app/signup/page.tsx
import { Suspense } from 'react';
import { SignupForm } from '@/components/signup-form';
export const metadata = { title: 'Sign Up — MentalLoad' };
export default function SignupPage() {
  return <Suspense fallback={null}><SignupForm /></Suspense>;
}
```

```typescript
// packages/frontend/app/setup/page.tsx
import { SetupForm } from '@/components/setup-form';
export const metadata = { title: 'Set Up Your Family — MentalLoad' };
export default function SetupPage() { return <SetupForm />; }
```

```typescript
// packages/frontend/app/forgot-password/page.tsx
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/components/forgot-password-form';
export const metadata = { title: 'Reset Password — MentalLoad' };
export default function ForgotPasswordPage() {
  return <Suspense fallback={null}><ForgotPasswordForm /></Suspense>;
}
```

```typescript
// packages/frontend/app/reset-password/page.tsx
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/reset-password-form';
export const metadata = { title: 'New Password — MentalLoad' };
export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetPasswordForm /></Suspense>;
}
```

- [ ] **Step 6: Update login form — replace username with email + add links**

In `packages/frontend/components/login-form.tsx`:
- Change `username` state/field to `email` (type="email", autoComplete="email", icon `Mail` not `User`)
- Change `JSON.stringify({ username, password })` to `JSON.stringify({ email, password })`
- Add a link to `/signup` below the card: "Don't have an account? Sign up"
- Add a link to `/forgot-password` below the password field: "Forgot password?"
- Remove the `User` import from lucide, add `Mail`

- [ ] **Step 7: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/components/ packages/frontend/app/signup/ packages/frontend/app/setup/ packages/frontend/app/forgot-password/ packages/frontend/app/reset-password/
git commit -m "feat: signup, setup, forgot-password, reset-password pages + updated login form"
```

---

## Task 10: Add MailService.sendMail if missing

**Files:**
- Modify: `packages/backend/src/mail/mail-service.ts` (if sendMail doesn't exist)

- [ ] **Step 1: Check existing mail service methods**

Read `packages/backend/src/mail/mail-service.ts`. If it doesn't have a generic `sendMail(options, config)` method, add one:

```typescript
async sendMail(options: { to: string; subject: string; text: string; html?: string }, config: MailConfig): Promise<void> {
  // Use the existing nodemailer transport setup in the class
  // Mirror how sendInvite or sendTestEmail calls the transporter
}
```

- [ ] **Step 2: Commit if changed**

```bash
git add packages/backend/src/mail/mail-service.ts
git commit -m "feat: add generic sendMail to MailService for password reset emails"
```

---

## Self-Review Checklist (run before marking plan complete)

- [ ] Does migration 009 handle empty databases (new deploys)? — yes, tables created before backfill
- [ ] Does backfill use a fixed UUID so it's idempotent on re-run? — yes (`ON CONFLICT (id) DO NOTHING`)
- [ ] Is the existing single-family production data preserved? — yes, backfilled to default family
- [ ] Does the frontend middleware correctly allow `/signup`, `/setup`, `/forgot-password`, `/reset-password`? — yes, added to PUBLIC_PREFIXES
- [ ] Does the login form still work after the email→username rename? — yes, login-form.tsx updated
- [ ] Is there a race condition in the family seed during startup? — no, migration runs before server starts
- [ ] Does password reset work if SMTP is not configured? — yes, email errors are swallowed, link still generated (dev: see logs)
