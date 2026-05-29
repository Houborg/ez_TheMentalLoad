# Manual Weekly Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow families to manually enter a recurring Mon–Fri school timetable per child member, which appears in the I dag timeline and member Skoleskema view, with an Aula data toggle and confirmation ticking.

**Architecture:** New `member_schedule` DB table stores recurring class slots (day_of_week, title, start_time, end_time). A `use_aula_schedule` boolean on `members` governs priority. The I dag view applies priority logic: Aula data first, manual fallback, or placeholder prompt. Confirmations stored in `aula_item_confirmations`. Calendar opt-in stored as `aula_item_id` FK on `entries`.

**Tech Stack:** PostgreSQL, Fastify, Node test runner, Next.js 16 / React 19, TypeScript

---

## File Map

| File | Change |
|---|---|
| `packages/backend/migrations/019_member_use_aula_schedule.sql` | New column on members |
| `packages/backend/migrations/020_member_schedule.sql` | New member_schedule table |
| `packages/backend/migrations/021_aula_item_confirmations.sql` | New aula_item_confirmations table |
| `packages/backend/migrations/022_entries_aula_item_id.sql` | Add aula_item_id FK to entries |
| `packages/contracts/src/domain.d.ts` | Add MemberScheduleEntry type; add useAulaSchedule to Member; add aulaItemId to Entry |
| `packages/contracts/src/api.ts` | Add CreateScheduleEntryRequest, UpdateMemberRequest.useAulaSchedule |
| `packages/backend/src/repositories/member-schedule-repository.ts` | Interface + InMemoryMemberScheduleRepository |
| `packages/backend/src/repositories/postgres/member-schedule-repository.ts` | Postgres implementation |
| `packages/backend/src/repositories/aula-confirmation-repository.ts` | Interface + InMemoryAulaConfirmationRepository |
| `packages/backend/src/repositories/postgres/aula-confirmation-repository.ts` | Postgres implementation |
| `packages/backend/src/app.ts` | Add schedule + confirmation routes; update member PATCH for useAulaSchedule |
| `packages/backend/src/service-context.ts` | Wire new repositories |
| `packages/backend/src/repositories/repository-factory.ts` | Instantiate new repos for postgres |
| `packages/backend/src/app.test.ts` | Integration tests for new routes |
| `packages/frontend/lib/api.ts` | getMemberSchedule, createScheduleEntry, deleteScheduleEntry, confirmAulaItem, unconfirmAulaItem, confirmScheduleEntry, unconfirmScheduleEntry, importAulaItemToCalendar, removeAulaCalendarImport |
| `packages/frontend/components/schedule-editor.tsx` | New ScheduleEditor bottom sheet component |
| `packages/frontend/components/familie-view.tsx` | Add 📅 icon to child cards |
| `packages/frontend/components/idag-view.tsx` | Priority logic + manual schedule + placeholder prompt |
| `packages/frontend/components/aula/member-school-schedule.tsx` | Extend to show calendar_lesson + manual entries with ticking |
| `packages/frontend/components/entry-details-popup.tsx` | Add Aula calendar import toggle |

---

## Task 1: Database migrations

**Files:**
- Create: `packages/backend/migrations/019_member_use_aula_schedule.sql`
- Create: `packages/backend/migrations/020_member_schedule.sql`
- Create: `packages/backend/migrations/021_aula_item_confirmations.sql`
- Create: `packages/backend/migrations/022_entries_aula_item_id.sql`

- [ ] **Step 1: Create migration 019**

`packages/backend/migrations/019_member_use_aula_schedule.sql`:
```sql
alter table members
  add column if not exists use_aula_schedule boolean not null default true;
```

- [ ] **Step 2: Create migration 020**

`packages/backend/migrations/020_member_schedule.sql`:
```sql
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
```

- [ ] **Step 3: Create migration 021**

`packages/backend/migrations/021_aula_item_confirmations.sql`:
```sql
create table if not exists aula_item_confirmations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  aula_item_id uuid not null references aula_items(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  unique (family_id, aula_item_id)
);
```

- [ ] **Step 4: Create migration 022**

`packages/backend/migrations/022_entries_aula_item_id.sql`:
```sql
alter table entries
  add column if not exists aula_item_id uuid references aula_items(id) on delete set null;

create index if not exists entries_aula_item_id
  on entries (aula_item_id) where aula_item_id is not null;
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/migrations/
git commit -m "feat(db): add member_schedule, aula_item_confirmations, use_aula_schedule, entries.aula_item_id"
```

---

## Task 2: Contracts — new types

**Files:**
- Modify: `packages/contracts/src/domain.d.ts`
- Modify: `packages/contracts/src/api.ts`

- [ ] **Step 1: Add MemberScheduleEntry to domain.d.ts**

After the `Entry` interface, add:

```typescript
export interface MemberScheduleEntry {
  id: string;
  memberId: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5;  // 1=Mon
  title: string;
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
  confirmed?: boolean;
  createdAt: string;
}
```

- [ ] **Step 2: Extend Member with useAulaSchedule**

In `domain.d.ts`, update `Member`:

```typescript
export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  email?: string;
  avatar?: string;
  color?: string;
  useAulaSchedule?: boolean;
  createdAt: string;
}
```

- [ ] **Step 3: Extend Entry with aulaItemId**

In `domain.d.ts`, add to the `Entry` interface after `parentEntryId`:

```typescript
  aulaItemId?: string;
```

- [ ] **Step 4: Extend api.ts**

In `packages/contracts/src/api.ts`, update `UpdateMemberRequest`:

```typescript
export interface UpdateMemberRequest {
  name?: string;
  role?: MemberRole;
  email?: string;
  avatar?: string;
  color?: string;
  useAulaSchedule?: boolean;
}
```

Add new request type after `UpdateMemberRequest`:

```typescript
export interface CreateScheduleEntryRequest {
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  title: string;
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/
git commit -m "feat(contracts): MemberScheduleEntry, useAulaSchedule on Member, aulaItemId on Entry"
```

---

## Task 3: Backend — schedule repository

**Files:**
- Create: `packages/backend/src/repositories/member-schedule-repository.ts`
- Create: `packages/backend/src/repositories/postgres/member-schedule-repository.ts`

- [ ] **Step 1: Write the interface and in-memory implementation**

`packages/backend/src/repositories/member-schedule-repository.ts`:

```typescript
import type { MemberScheduleEntry } from '@mental-load/contracts';

export interface MemberScheduleRepository {
  list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]>;
  create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry>;
  delete(familyId: string, entryId: string): Promise<boolean>;
  setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean>;
}

export class InMemoryMemberScheduleRepository implements MemberScheduleRepository {
  private rows: Array<MemberScheduleEntry & { familyId: string; _confirmed: boolean }> = [];

  async list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]> {
    return this.rows
      .filter(r => r.familyId === familyId && r.memberId === memberId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
      .map(r => ({ ...r, confirmed: r._confirmed }));
  }

  async create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry> {
    const row = {
      id: crypto.randomUUID(),
      memberId,
      familyId,
      _confirmed: false,
      confirmed: false,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.rows.push(row);
    return { id: row.id, memberId: row.memberId, dayOfWeek: row.dayOfWeek, title: row.title, startTime: row.startTime, endTime: row.endTime, confirmed: false, createdAt: row.createdAt };
  }

  async delete(familyId: string, entryId: string): Promise<boolean> {
    const idx = this.rows.findIndex(r => r.id === entryId && r.familyId === familyId);
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean> {
    const row = this.rows.find(r => r.id === entryId && r.familyId === familyId);
    if (!row) return false;
    row._confirmed = confirmed;
    return true;
  }
}
```

- [ ] **Step 2: Write the Postgres implementation**

`packages/backend/src/repositories/postgres/member-schedule-repository.ts`:

```typescript
import type { Pool } from 'pg';
import type { MemberScheduleEntry } from '@mental-load/contracts';
import type { MemberScheduleRepository } from '../member-schedule-repository.js';

function rowToEntry(row: Record<string, unknown>, confirmed = false): MemberScheduleEntry {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    dayOfWeek: Number(row.day_of_week) as 1 | 2 | 3 | 4 | 5,
    title: String(row.title),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    confirmed,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresMemberScheduleRepository implements MemberScheduleRepository {
  constructor(private readonly pool: Pool, private readonly familyId: string) {}

  async list(familyId: string, memberId: string): Promise<MemberScheduleEntry[]> {
    const { rows } = await this.pool.query(
      `select ms.*, exists(
         select 1 from aula_item_confirmations aic
         where aic.family_id = $1 and aic.aula_item_id::text = ms.id::text
       ) as confirmed
       from member_schedule ms
       where ms.family_id = $1 and ms.member_id = $2
       order by ms.day_of_week, ms.start_time`,
      [familyId, memberId],
    );
    return rows.map(r => rowToEntry(r, Boolean(r.confirmed)));
  }

  async create(familyId: string, memberId: string, entry: Omit<MemberScheduleEntry, 'id' | 'memberId' | 'confirmed' | 'createdAt'>): Promise<MemberScheduleEntry> {
    const { rows } = await this.pool.query(
      `insert into member_schedule (family_id, member_id, day_of_week, title, start_time, end_time)
       values ($1, $2, $3, $4, $5::time, $6::time)
       returning *`,
      [familyId, memberId, entry.dayOfWeek, entry.title, entry.startTime, entry.endTime],
    );
    return rowToEntry(rows[0], false);
  }

  async delete(familyId: string, entryId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `delete from member_schedule where id = $1 and family_id = $2`,
      [entryId, familyId],
    );
    return (rowCount ?? 0) > 0;
  }

  async setConfirmed(familyId: string, entryId: string, confirmed: boolean): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'update member_schedule set confirmed = $3 where id = $1 and family_id = $2',
      [entryId, familyId, confirmed],
    );
    return (rowCount ?? 0) > 0;
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/repositories/member-schedule-repository.ts packages/backend/src/repositories/postgres/member-schedule-repository.ts
git commit -m "feat(backend): MemberScheduleRepository — interface + in-memory + postgres"
```

---

## Task 4: Backend — confirmation repository

**Files:**
- Create: `packages/backend/src/repositories/aula-confirmation-repository.ts`
- Create: `packages/backend/src/repositories/postgres/aula-confirmation-repository.ts`

- [ ] **Step 1: Interface + in-memory**

`packages/backend/src/repositories/aula-confirmation-repository.ts`:

```typescript
export interface AulaConfirmationRepository {
  /** Returns set of aula_item_ids that are confirmed for this family */
  listConfirmed(familyId: string): Promise<Set<string>>;
  confirm(familyId: string, aulaItemId: string): Promise<void>;
  unconfirm(familyId: string, aulaItemId: string): Promise<void>;
}

export class InMemoryAulaConfirmationRepository implements AulaConfirmationRepository {
  private confirmed: Map<string, Set<string>> = new Map();

  async listConfirmed(familyId: string): Promise<Set<string>> {
    return new Set(this.confirmed.get(familyId) ?? []);
  }

  async confirm(familyId: string, aulaItemId: string): Promise<void> {
    if (!this.confirmed.has(familyId)) this.confirmed.set(familyId, new Set());
    this.confirmed.get(familyId)!.add(aulaItemId);
  }

  async unconfirm(familyId: string, aulaItemId: string): Promise<void> {
    this.confirmed.get(familyId)?.delete(aulaItemId);
  }
}
```

- [ ] **Step 2: Postgres implementation**

`packages/backend/src/repositories/postgres/aula-confirmation-repository.ts`:

```typescript
import type { Pool } from 'pg';
import type { AulaConfirmationRepository } from '../aula-confirmation-repository.js';

export class PostgresAulaConfirmationRepository implements AulaConfirmationRepository {
  constructor(private readonly pool: Pool) {}

  async listConfirmed(familyId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query(
      `select aula_item_id::text from aula_item_confirmations where family_id = $1`,
      [familyId],
    );
    return new Set(rows.map((r: { aula_item_id: string }) => r.aula_item_id));
  }

  async confirm(familyId: string, aulaItemId: string): Promise<void> {
    await this.pool.query(
      `insert into aula_item_confirmations (family_id, aula_item_id)
       values ($1, $2)
       on conflict (family_id, aula_item_id) do nothing`,
      [familyId, aulaItemId],
    );
  }

  async unconfirm(familyId: string, aulaItemId: string): Promise<void> {
    await this.pool.query(
      `delete from aula_item_confirmations where family_id = $1 and aula_item_id = $2`,
      [familyId, aulaItemId],
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/repositories/aula-confirmation-repository.ts packages/backend/src/repositories/postgres/aula-confirmation-repository.ts
git commit -m "feat(backend): AulaConfirmationRepository — interface + in-memory + postgres"
```

---

## Task 5: Backend — wire repositories into service context

**Files:**
- Modify: `packages/backend/src/service-context.ts`
- Modify: `packages/backend/src/repositories/repository-factory.ts`

- [ ] **Step 1: Read service-context.ts**

Open `packages/backend/src/service-context.ts` and check its current shape (it exposes repositories from a factory). Add:

```typescript
import type { MemberScheduleRepository } from './repositories/member-schedule-repository.js';
import type { AulaConfirmationRepository } from './repositories/aula-confirmation-repository.js';
```

Add these two fields to the `ServiceContext` type/interface:

```typescript
memberScheduleRepository: MemberScheduleRepository;
aulaConfirmationRepository: AulaConfirmationRepository;
```

- [ ] **Step 2: Update repository-factory.ts**

In `packages/backend/src/repositories/repository-factory.ts`, import and instantiate:

```typescript
import { InMemoryMemberScheduleRepository } from './member-schedule-repository.js';
import { InMemoryAulaConfirmationRepository } from './aula-confirmation-repository.js';
import { PostgresMemberScheduleRepository } from './postgres/member-schedule-repository.js';
import { PostgresAulaConfirmationRepository } from './postgres/aula-confirmation-repository.js';
```

In the in-memory factory branch, add:
```typescript
memberScheduleRepository: new InMemoryMemberScheduleRepository(),
aulaConfirmationRepository: new InMemoryAulaConfirmationRepository(),
```

In the Postgres factory branch, add:
```typescript
memberScheduleRepository: new PostgresMemberScheduleRepository(pool),
aulaConfirmationRepository: new PostgresAulaConfirmationRepository(pool),
```

Also update the postgres member-repository to read and write `use_aula_schedule`:

In `packages/backend/src/repositories/postgres/member-repository.ts`, update the SELECT to include `use_aula_schedule`:

```typescript
// In the list() and findById() queries, add use_aula_schedule to the SELECT list
// In rowToMember, add:
useAulaSchedule: row.use_aula_schedule ?? true,
// In create(), add use_aula_schedule to INSERT (default true)
// In update(), include use_aula_schedule in the SET if provided in patch
```

Exact changes to `packages/backend/src/repositories/postgres/member-repository.ts`:

Replace the select query in `list()`:
```typescript
'select id, name, role, email, avatar, color, use_aula_schedule, created_at from members where family_id = $1 order by created_at asc'
```

Replace the select query in `findById()`:
```typescript
'select id, name, role, email, avatar, color, use_aula_schedule, created_at from members where id = $1 and family_id = $2'
```

Replace the rowToMember mapping (both places):
```typescript
{
  id: row.id,
  name: row.name,
  role: row.role,
  email: row.email ?? undefined,
  avatar: row.avatar ?? undefined,
  color: row.color ?? undefined,
  useAulaSchedule: row.use_aula_schedule ?? true,
  createdAt: new Date(row.created_at).toISOString(),
}
```

Replace the update query to include use_aula_schedule:
```typescript
await this.pool.query(
  'update members set name = $2, role = $3, email = $4, avatar = $5, color = $6, use_aula_schedule = $7 where id = $1 and family_id = $8',
  [id, next.name, next.role, next.email ?? null, next.avatar ?? null, next.color ?? null, next.useAulaSchedule ?? true, familyId],
);
```

Also update the `InMemoryMemberRepository` in `member-repository.ts` to preserve `useAulaSchedule` in update().

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/
git commit -m "feat(backend): wire schedule + confirmation repos; postgres member includes useAulaSchedule"
```

---

## Task 6: Backend — routes for schedule + confirmations

**Files:**
- Modify: `packages/backend/src/app.ts`

Add these routes after the existing member routes (around line 536 in `app.ts`):

- [ ] **Step 1: Add schedule routes to app.ts**

After `app.delete('/api/v1/members/:id', ...)`, add:

```typescript
// ── Member schedule ───────────────────────────────────────────────────────────

app.get<{ Params: { memberId: string } }>('/api/v1/members/:memberId/schedule', async (request) => {
  const { memberScheduleRepository } = svc(request);
  return memberScheduleRepository.list(request.familyId, request.params.memberId);
});

app.post<{ Params: { memberId: string }; Body: CreateScheduleEntryRequest }>(
  '/api/v1/members/:memberId/schedule',
  async (request, reply) => {
    const { dayOfWeek, title, startTime, endTime } = request.body;
    if (!dayOfWeek || !title?.trim() || !startTime || !endTime) {
      reply.code(400);
      return { message: 'dayOfWeek, title, startTime, endTime are required' };
    }
    const { memberScheduleRepository } = svc(request);
    const entry = await memberScheduleRepository.create(request.familyId, request.params.memberId, {
      dayOfWeek: dayOfWeek as 1 | 2 | 3 | 4 | 5,
      title: title.trim(),
      startTime,
      endTime,
    });
    reply.code(201);
    return entry;
  },
);

app.delete<{ Params: { memberId: string; entryId: string } }>(
  '/api/v1/members/:memberId/schedule/:entryId',
  async (request, reply) => {
    const deleted = await svc(request).memberScheduleRepository.delete(request.familyId, request.params.entryId);
    if (!deleted) { reply.code(404); return { message: 'Entry not found' }; }
    reply.code(204);
  },
);

app.post<{ Params: { memberId: string; entryId: string } }>(
  '/api/v1/members/:memberId/schedule/:entryId/confirm',
  async (request, reply) => {
    const ok = await svc(request).memberScheduleRepository.setConfirmed(request.familyId, request.params.entryId, true);
    if (!ok) { reply.code(404); return { message: 'Entry not found' }; }
    reply.code(204);
  },
);

app.delete<{ Params: { memberId: string; entryId: string } }>(
  '/api/v1/members/:memberId/schedule/:entryId/confirm',
  async (request, reply) => {
    await svc(request).memberScheduleRepository.setConfirmed(request.familyId, request.params.entryId, false);
    reply.code(204);
  },
);

// ── Aula item confirmations ────────────────────────────────────────────────────

app.post<{ Params: { id: string } }>('/api/v1/aula/items/:id/confirm', async (request, reply) => {
  await svc(request).aulaConfirmationRepository.confirm(request.familyId, request.params.id);
  reply.code(204);
});

app.delete<{ Params: { id: string } }>('/api/v1/aula/items/:id/confirm', async (request, reply) => {
  await svc(request).aulaConfirmationRepository.unconfirm(request.familyId, request.params.id);
  reply.code(204);
});
```

- [ ] **Step 2: Update member PATCH to handle useAulaSchedule**

In the existing `app.patch('/api/v1/members/:id', ...)` handler, after the color check, add:

```typescript
if (typeof request.body.useAulaSchedule === 'boolean') {
  patch.useAulaSchedule = request.body.useAulaSchedule;
}
```

Also add `CreateScheduleEntryRequest` to the imports from `@mental-load/contracts` at the top of `app.ts`.

- [ ] **Step 3: Update Aula items GET to include confirmed status**

In the existing `GET /api/v1/aula/items` route, after fetching items, annotate each with its confirmation state:

```typescript
// After fetching items array:
const confirmedSet = await svc(request).aulaConfirmationRepository.listConfirmed(request.familyId);
const annotated = items.map(item => ({
  ...item,
  confirmed: confirmedSet.has(item.id),
}));
return { items: annotated };
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat(backend): schedule CRUD routes, confirmation routes, useAulaSchedule in member PATCH"
```

---

## Task 7: Backend tests

**Files:**
- Modify: `packages/backend/src/app.test.ts`

- [ ] **Step 1: Write failing tests for schedule routes**

Add to `packages/backend/src/app.test.ts`:

```typescript
describe('member schedule', () => {
  it('creates and lists a schedule entry', async () => {
    const app = await buildApp();
    const { memberId } = await createFamilyAndMember(app); // use existing test helper pattern

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/members/${memberId}/schedule`,
      headers: authHeaders,
      payload: { dayOfWeek: 1, title: 'Matematik', startTime: '08:00', endTime: '09:00' },
    });
    assert.strictEqual(createRes.statusCode, 201);
    const entry = JSON.parse(createRes.body);
    assert.strictEqual(entry.title, 'Matematik');
    assert.strictEqual(entry.dayOfWeek, 1);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/members/${memberId}/schedule`,
      headers: authHeaders,
    });
    assert.strictEqual(listRes.statusCode, 200);
    const entries = JSON.parse(listRes.body);
    assert.strictEqual(entries.length, 1);
  });

  it('deletes a schedule entry', async () => {
    const app = await buildApp();
    const { memberId } = await createFamilyAndMember(app);

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/members/${memberId}/schedule`,
      headers: authHeaders,
      payload: { dayOfWeek: 2, title: 'Dansk', startTime: '09:15', endTime: '10:15' },
    });
    const { id } = JSON.parse(createRes.body);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/members/${memberId}/schedule/${id}`,
      headers: authHeaders,
    });
    assert.strictEqual(delRes.statusCode, 204);

    const listRes = await app.inject({ method: 'GET', url: `/api/v1/members/${memberId}/schedule`, headers: authHeaders });
    assert.strictEqual(JSON.parse(listRes.body).length, 0);
  });

  it('confirms and unconfirms a schedule entry', async () => {
    const app = await buildApp();
    const { memberId } = await createFamilyAndMember(app);

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/members/${memberId}/schedule`,
      headers: authHeaders,
      payload: { dayOfWeek: 3, title: 'Naturfag', startTime: '10:30', endTime: '11:30' },
    });
    const { id } = JSON.parse(createRes.body);

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/members/${memberId}/schedule/${id}/confirm`,
      headers: authHeaders,
    });
    assert.strictEqual(confirmRes.statusCode, 204);

    const listRes = await app.inject({ method: 'GET', url: `/api/v1/members/${memberId}/schedule`, headers: authHeaders });
    const entries = JSON.parse(listRes.body);
    assert.strictEqual(entries[0].confirmed, true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:integration
```
Expected: new tests pass, existing tests still pass

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/app.test.ts
git commit -m "test(backend): schedule CRUD and confirmation integration tests"
```

---

## Task 8: Frontend — api.ts additions

**Files:**
- Modify: `packages/frontend/lib/api.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/frontend/lib/api.ts`, ensure `MemberScheduleEntry` and `CreateScheduleEntryRequest` are imported from `@mental-load/contracts`.

- [ ] **Step 2: Add schedule fetch wrappers**

After the existing `updateMember` function, add:

```typescript
export async function getMemberSchedule(memberId: string): Promise<MemberScheduleEntry[]> {
  return apiFetch<MemberScheduleEntry[]>(`/api/v1/members/${memberId}/schedule`);
}

export async function createScheduleEntry(memberId: string, payload: CreateScheduleEntryRequest): Promise<MemberScheduleEntry> {
  return apiFetch<MemberScheduleEntry>(`/api/v1/members/${memberId}/schedule`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/members/${memberId}/schedule/${entryId}`, { method: 'DELETE' });
}

export async function confirmScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/members/${memberId}/schedule/${entryId}/confirm`, { method: 'POST' });
}

export async function unconfirmScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/members/${memberId}/schedule/${entryId}/confirm`, { method: 'DELETE' });
}

export async function confirmAulaItem(itemId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/aula/items/${itemId}/confirm`, { method: 'POST' });
}

export async function unconfirmAulaItem(itemId: string): Promise<void> {
  await apiFetch<void>(`/api/v1/aula/items/${itemId}/confirm`, { method: 'DELETE' });
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/lib/api.ts
git commit -m "feat(frontend): schedule + confirmation API wrappers"
```

---

## Task 9: Frontend — ScheduleEditor component

**Files:**
- Create: `packages/frontend/components/schedule-editor.tsx`

- [ ] **Step 1: Create the component**

`packages/frontend/components/schedule-editor.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Member, MemberScheduleEntry } from '@mental-load/contracts';
import {
  getMemberSchedule, createScheduleEntry, deleteScheduleEntry, updateMember,
} from '@/lib/api';

const DAY_LABELS = ['', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'] as const;

interface Props {
  member: Member;
  aulaConnected: boolean;
  onClose: () => void;
  onMemberUpdated: (m: Member) => void;
}

interface AddForm {
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  title: string;
  startTime: string;
  endTime: string;
  repeatDays: number[];
}

export function ScheduleEditor({ member, aulaConnected, onClose, onMemberUpdated }: Props) {
  const useAula = member.useAulaSchedule ?? true;
  const [entries, setEntries] = useState<MemberScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingDay, setAddingDay] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [form, setForm] = useState<AddForm>({ dayOfWeek: 1, title: '', startTime: '08:00', endTime: '09:00', repeatDays: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getMemberSchedule(member.id)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [member.id]);

  const toggleAula = async () => {
    const next = !useAula;
    const updated = await updateMember(member.id, { useAulaSchedule: next });
    onMemberUpdated(updated);
  };

  const openAdd = (day: 1 | 2 | 3 | 4 | 5) => {
    setAddingDay(day);
    setForm({ dayOfWeek: day, title: '', startTime: '08:00', endTime: '09:00', repeatDays: [day] });
  };

  const saveEntry = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const days = form.repeatDays.length > 0 ? form.repeatDays : [form.dayOfWeek];
    const created: MemberScheduleEntry[] = [];
    for (const d of days as (1 | 2 | 3 | 4 | 5)[]) {
      const entry = await createScheduleEntry(member.id, {
        dayOfWeek: d,
        title: form.title.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
      });
      created.push(entry);
    }
    setEntries(prev => [...prev, ...created].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)));
    setAddingDay(null);
    setSaving(false);
  };

  const removeEntry = async (entryId: string) => {
    await deleteScheduleEntry(member.id, entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-card p-5 pb-8 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-muted" />

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white"
            style={{ background: member.color ?? '#6d5efc' }}
          >
            {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-bold">{member.name} — Ugeskema</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aula toggle */}
        <div className="mb-5 flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Brug Aula-data</div>
            <div className="text-xs text-muted-foreground">
              {aulaConnected ? 'Synkroniseret automatisk' : 'Aula ikke tilknyttet'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useAula}
            onClick={toggleAula}
            className={`relative h-6 w-11 rounded-full transition-colors ${useAula ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${useAula ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Schedule editor */}
        <div className={useAula ? 'pointer-events-none opacity-40' : ''}>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Manuelt ugeskema
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Henter…</p>
          ) : (
            <div className="space-y-3">
              {([1, 2, 3, 4, 5] as const).map(day => {
                const dayEntries = entries.filter(e => e.dayOfWeek === day);
                return (
                  <div key={day}>
                    <div className="mb-1 text-xs font-bold">{DAY_LABELS[day]}</div>
                    <div className="space-y-1">
                      {dayEntries.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                          <span className="flex-1 text-sm font-medium">{entry.title}</span>
                          <span className="text-xs text-muted-foreground">{entry.startTime}–{entry.endTime}</span>
                          <button type="button" onClick={() => removeEntry(entry.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      {addingDay === day ? (
                        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                          <div className="text-xs font-bold text-primary">Ny time — {DAY_LABELS[day]}</div>
                          <input
                            autoFocus
                            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                            placeholder="Fagnavn"
                            value={form.title}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Start</div>
                              <input
                                type="time"
                                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                value={form.startTime}
                                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                              />
                            </div>
                            <div className="flex-1">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Slut</div>
                              <input
                                type="time"
                                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                value={form.endTime}
                                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Gentag også</div>
                            <div className="flex gap-1.5">
                              {([1, 2, 3, 4, 5] as const).map(d => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setForm(f => ({
                                    ...f,
                                    repeatDays: f.repeatDays.includes(d)
                                      ? f.repeatDays.filter(x => x !== d)
                                      : [...f.repeatDays, d],
                                  }))}
                                  className={`rounded-full px-2 py-0.5 text-xs font-bold transition-colors ${
                                    form.repeatDays.includes(d)
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {['Man', 'Tir', 'Ons', 'Tor', 'Fre'][d - 1]}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAddingDay(null)}
                              className="flex-1 rounded-lg bg-muted py-2 text-sm"
                            >Annuller</button>
                            <button
                              type="button"
                              onClick={saveEntry}
                              disabled={saving || !form.title.trim()}
                              className="flex-[2] rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                            >Gem time</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAdd(day)}
                          className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
                        >
                          <Plus className="h-3 w-3" />
                          Tilføj time
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/schedule-editor.tsx
git commit -m "feat(frontend): ScheduleEditor bottom sheet component"
```

---

## Task 10: Frontend — familie-view.tsx — add 📅 icon to child cards

**Files:**
- Modify: `packages/frontend/components/familie-view.tsx`
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Add ScheduleEditor import and state to FamilieView**

In `familie-view.tsx`, add imports:

```typescript
import { CalendarDays } from 'lucide-react';
import { ScheduleEditor } from '@/components/schedule-editor';
```

Add a prop to the `Props` type:
```typescript
aulaConnected: boolean;
onMemberUpdated: (m: Member) => void;
```

Add state inside `FamilieView`:
```typescript
const [scheduleEditorMemberId, setScheduleEditorMemberId] = useState<string | null>(null);
const scheduleEditorMember = members.find(m => m.id === scheduleEditorMemberId) ?? null;
```

- [ ] **Step 2: Add 📅 button to child card headers**

In the card header section of `familie-view.tsx`, inside the `{/* Progress bar + chevron */}` area, add before the chevron (only for child members):

```tsx
{member.role === 'child' && (
  <button
    type="button"
    aria-label={`Rediger ugeskema for ${member.name}`}
    onClick={(e) => { e.stopPropagation(); setScheduleEditorMemberId(member.id); }}
    className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 hover:bg-muted"
  >
    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
  </button>
)}
```

- [ ] **Step 3: Render ScheduleEditor**

At the bottom of the `FamilieView` return, before the closing `</div>`, add:

```tsx
{scheduleEditorMember && (
  <ScheduleEditor
    member={scheduleEditorMember}
    aulaConnected={aulaConnected}
    onClose={() => setScheduleEditorMemberId(null)}
    onMemberUpdated={(updated) => { onMemberUpdated(updated); }}
  />
)}
```

- [ ] **Step 4: Wire new props in dashboard-app.tsx**

In `dashboard-app.tsx`, find where `<FamilieView>` is rendered (around line 1874) and add the new props:

```tsx
<FamilieView
  ...existing props...
  aulaConnected={!!dashboard.settings?.aula_connection}
  onMemberUpdated={(updated) => {
    setDashboard(prev => ({
      ...prev,
      members: prev.members.map(m => m.id === updated.id ? updated : m),
    }));
  }}
/>
```

Check how `dashboard.settings` exposes the Aula connection — search for `aula_connection` or `aulaConnection` in `dashboard-app.tsx` and use the correct path.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/components/familie-view.tsx packages/frontend/components/dashboard-app.tsx
git commit -m "feat(frontend): 📅 schedule editor icon on child member cards in Familie view"
```

---

## Task 11: Frontend — idag-view.tsx — priority logic + placeholder

**Files:**
- Modify: `packages/frontend/components/idag-view.tsx`

- [ ] **Step 1: Import getMemberSchedule**

At the top of `idag-view.tsx`, add:

```typescript
import { getMemberSchedule } from '@/lib/api';
```

- [ ] **Step 2: Add noScheduleChildIds state**

Inside `IDagView`, add:

```typescript
const [noScheduleChildIds, setNoScheduleChildIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Update the lesson loading useEffect**

Replace the entire `useEffect` (lines 69–147) with this version that applies priority logic and populates `noScheduleChildIds`:

```typescript
useEffect(() => {
  if (!isSchoolDay) return;
  const children = members.filter((m) => m.role === 'child');
  if (children.length === 0) return;

  Promise.all(
    children.map(async (child) => {
      try {
        // 1. If useAulaSchedule is explicitly false, skip Aula entirely
        if (child.useAulaSchedule === false) {
          const schedule = await getMemberSchedule(child.id);
          const todayDowJs = new Date().getDay(); // 0=Sun, 1=Mon...
          const todayDow = todayDowJs === 0 ? 7 : todayDowJs; // align to 1=Mon
          const todayEntries = schedule.filter(e => e.dayOfWeek === todayDow);
          if (todayEntries.length === 0) return { lessons: [], noSchedule: true, childId: child.id };
          return {
            childId: child.id,
            noSchedule: false,
            lessons: todayEntries.map(e => ({
              memberId: child.id,
              title: e.title,
              date: todayStr,
              startTime: e.startTime,
              endTime: e.endTime,
            } as AulaLesson)),
          };
        }

        // 2. Try Aula calendar_lesson
        const { items } = await aulaGetItems({ type: 'calendar_lesson', memberId: child.id, pageSize: 100 });
        const todayLessons = items.filter((item) => {
          const raw = item.raw_json as Record<string, unknown> | undefined;
          return String(raw?.startTime ?? '').startsWith(todayStr);
        });

        if (todayLessons.length > 0) {
          return {
            childId: child.id, noSchedule: false,
            lessons: todayLessons.map((item) => {
              const raw = item.raw_json as Record<string, unknown>;
              const toHHMM = (iso: string) => {
                if (!iso) return undefined;
                return new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });
              };
              return { memberId: child.id, title: String(raw.title ?? item.title ?? 'Lektion'), date: todayStr, startTime: toHHMM(String(raw.startTime ?? '')), endTime: toHHMM(String(raw.endTime ?? '')) } as AulaLesson;
            }),
          };
        }

        // 3. Try weekplan_lesson
        const { items: wpItems } = await aulaGetItems({ type: 'weekplan_lesson', memberId: child.id, pageSize: 50 });
        const wpToday = wpItems.filter(i => (i.raw_json as Record<string, unknown>)?.date === todayStr);
        if (wpToday.length > 0) {
          return {
            childId: child.id, noSchedule: false,
            lessons: wpToday.map(item => {
              const raw = item.raw_json as Record<string, unknown>;
              return { memberId: child.id, title: String(raw.title ?? item.title ?? 'Lektion'), date: String(raw.date ?? todayStr), startTime: raw.startTime ? String(raw.startTime) : undefined, endTime: raw.endTime ? String(raw.endTime) : undefined } as AulaLesson;
            }),
          };
        }

        // 4. Aula empty — try manual schedule as fallback
        const schedule = await getMemberSchedule(child.id);
        const todayDowJs = new Date().getDay();
        const todayDow = todayDowJs === 0 ? 7 : todayDowJs;
        const manualToday = schedule.filter(e => e.dayOfWeek === todayDow);
        if (manualToday.length > 0) {
          return {
            childId: child.id, noSchedule: false,
            lessons: manualToday.map(e => ({ memberId: child.id, title: e.title, date: todayStr, startTime: e.startTime, endTime: e.endTime } as AulaLesson)),
          };
        }

        return { childId: child.id, noSchedule: true, lessons: [] };
      } catch {
        return { childId: child.id, noSchedule: true, lessons: [] };
      }
    }),
  ).then((results) => {
    const noSchedule = new Set(results.filter(r => r.noSchedule).map(r => r.childId));
    setNoScheduleChildIds(noSchedule);
    const flat = results.flatMap(r => r.lessons);
    setAulaLessons(flat);
  });
}, [todayStr, isSchoolDay, members.map(m => m.id + (m.useAulaSchedule ?? true)).join(',')]);
```

- [ ] **Step 4: Pass noScheduleChildIds to TimeGrid and render placeholder**

In the TimeGrid component call inside `idag-view.tsx`, the `TimeGrid` itself doesn't need changes. Instead, add a `noSchedulePrompt` prop or handle it here by checking `noScheduleChildIds` in the view layer.

Add a prop to `IDagView`:

```typescript
onOpenScheduleEditor?: (memberId: string) => void;
```

In the `<TimeGrid>` wrapper area in `idag-view.tsx`, after the TimeGrid, add a row of placeholder prompts for children with no schedule:

```tsx
{isSchoolDay && noScheduleChildIds.size > 0 && (
  <div className="flex gap-3 px-1">
    {members.filter(m => m.role === 'child' && noScheduleChildIds.has(m.id)).map(m => (
      <button
        key={m.id}
        type="button"
        onClick={() => onOpenScheduleEditor?.(m.id)}
        className="flex-1 rounded-xl border border-dashed border-border py-3 text-center text-xs text-muted-foreground hover:border-primary hover:text-primary"
      >
        <div className="font-semibold">{m.name}</div>
        <div>Ingen skemadata</div>
        <div className="mt-0.5 text-primary">Tilføj manuelt →</div>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: Wire onOpenScheduleEditor in dashboard-app.tsx**

In `dashboard-app.tsx` where `<IDagView>` is rendered, add:

```tsx
onOpenScheduleEditor={(memberId) => {
  setActiveNav('family');
  // open schedule editor for that member — use a state variable
}}
```

A simple approach: add `pendingScheduleEditorMemberId` state to `dashboard-app.tsx` and pass it down to `FamilieView` which auto-opens the editor on mount if set.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/components/idag-view.tsx packages/frontend/components/dashboard-app.tsx
git commit -m "feat(frontend): idag-view priority logic — Aula → manual fallback → placeholder prompt"
```

---

## Task 12: Frontend — MemberSchoolSchedule — extend with calendar_lesson + manual + ticking

**Files:**
- Modify: `packages/frontend/components/aula/member-school-schedule.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { getMemberSchedule, confirmAulaItem, unconfirmAulaItem, confirmScheduleEntry, unconfirmScheduleEntry } from '@/lib/api';
import type { MemberScheduleEntry } from '@mental-load/contracts';
import { Check } from 'lucide-react';
```

- [ ] **Step 2: Add member prop and schedule state**

Update `Props`:
```typescript
interface Props {
  memberId: string;
  memberName: string;
  memberColor?: string;
  useAulaSchedule?: boolean;
}
```

Add state for manual entries and confirmed set:
```typescript
const [manualEntries, setManualEntries] = useState<MemberScheduleEntry[]>([]);
const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Load calendar_lesson items alongside weekplan_lesson**

Update the useEffect to also load `calendar_lesson` items and manual entries:

```typescript
useEffect(() => {
  let active = true;
  setLoading(true);

  Promise.all([
    aulaGetItems({ type: 'calendar_lesson', memberId, pageSize: 200 }),
    aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 }),
    getMemberSchedule(memberId),
  ]).then(([calRes, wpRes, manual]) => {
    if (!active) return;
    // Merge Aula items: prefer calendar_lesson when they exist for the week
    const allAula = [...calRes.items, ...wpRes.items];
    setItems(allAula);
    setManualEntries(manual);
    // Build confirmed set from items that have confirmed=true (annotated by backend)
    const confirmed = new Set<string>();
    allAula.forEach(i => { if ((i as { confirmed?: boolean }).confirmed) confirmed.add(i.id); });
    manual.forEach(e => { if (e.confirmed) confirmed.add(e.id); });
    setConfirmedIds(confirmed);
  }).catch(() => {
    if (active) { setItems([]); setManualEntries([]); }
  }).finally(() => { if (active) setLoading(false); });

  return () => { active = false; };
}, [memberId]);
```

- [ ] **Step 4: Build unified lesson list per day**

Replace `weekItems` useMemo with one that merges Aula + manual entries:

```typescript
const weekLessonsByDay = useMemo(() => {
  const start = ymd(weekStart);
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 5);

  // Aula items: filter to this week
  const aulaThisWeek = items.filter(i => {
    if (!i.published_at) return false;
    const d = i.published_at.slice(0, 10);
    return d >= start && d < ymd(endDate);
  });

  // Manual entries: map day_of_week to the actual date in this week
  const manualThisWeek = manualEntries.map(e => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + (e.dayOfWeek - 1));
    return { ...e, _dateStr: ymd(dayDate) };
  });

  // Build per-day map (0..4 = Mon..Fri)
  const byDay: Record<string, Array<{ id: string; title: string; time?: string; isManual: boolean }>> = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const key = ymd(d);
    const aulaDay = aulaThisWeek
      .filter(it => it.published_at!.slice(0, 10) === key)
      .map(it => ({ id: it.id, title: it.title ?? 'Lektion', time: (it.raw_json as { startTime?: string })?.startTime ?? undefined, isManual: false }));
    const manualDay = manualThisWeek
      .filter(e => e._dateStr === key)
      .map(e => ({ id: e.id, title: e.title, time: e.startTime, isManual: true }));
    byDay[key] = [...aulaDay, ...manualDay].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }
  return byDay;
}, [items, manualEntries, weekStart]);
```

- [ ] **Step 5: Render with ticking**

Replace the lesson rendering inside the `WEEKDAY_LABELS.map(...)` with:

```tsx
{Object.entries(weekLessonsByDay).map(([dayKey, lessons], idx) => (
  <div key={dayKey} className="rounded-2xl border border-border/60 bg-card/50 p-3">
    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
      {WEEKDAY_LABELS[idx]}
    </div>
    {lessons.length === 0 ? (
      <div className="text-xs text-muted-foreground">Ingen lektioner</div>
    ) : (
      <div className="space-y-1">
        {lessons.map(lesson => {
          const isConfirmed = confirmedIds.has(lesson.id);
          const toggle = async () => {
            if (lesson.isManual) {
              if (isConfirmed) { await unconfirmScheduleEntry(memberId, lesson.id); setConfirmedIds(prev => { const s = new Set(prev); s.delete(lesson.id); return s; }); }
              else { await confirmScheduleEntry(memberId, lesson.id); setConfirmedIds(prev => new Set([...prev, lesson.id])); }
            } else {
              if (isConfirmed) { await unconfirmAulaItem(lesson.id); setConfirmedIds(prev => { const s = new Set(prev); s.delete(lesson.id); return s; }); }
              else { await confirmAulaItem(lesson.id); setConfirmedIds(prev => new Set([...prev, lesson.id])); }
            }
          };
          return (
            <div key={lesson.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent">
              <button
                type="button"
                onClick={toggle}
                aria-label={isConfirmed ? 'Fjern bekræftelse' : 'Bekræft lektion'}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  isConfirmed
                    ? 'border-transparent text-white'
                    : 'border-muted-foreground/40 text-transparent'
                }`}
                style={isConfirmed ? { background: memberColor ?? '#6d5efc' } : {}}
              >
                <Check className="h-3 w-3" />
              </button>
              <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{lesson.time ?? '—'}</span>
              <span className={`flex-1 text-sm font-medium ${isConfirmed ? 'text-muted-foreground line-through' : ''}`}>
                {lesson.title}
              </span>
            </div>
          );
        })}
      </div>
    )}
  </div>
))}
```

- [ ] **Step 6: Update the null-guard**

Replace the early return:
```typescript
if (!loading && items.length === 0 && manualEntries.length === 0) return null;
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/components/aula/member-school-schedule.tsx
git commit -m "feat(frontend): MemberSchoolSchedule — calendar_lesson + manual entries + ticking"
```

---

## Task 13: Frontend — Entry details popup — Aula calendar import toggle

**Files:**
- Modify: `packages/frontend/components/entry-details-popup.tsx`

This toggle appears when viewing an Aula-sourced entry (`entry.aulaItemId` is set). It lets the user create or remove a corresponding calendar `Entry`.

- [ ] **Step 1: Read the current popup**

Open `packages/frontend/components/entry-details-popup.tsx` and understand its current props and layout.

- [ ] **Step 2: Import createEntry, deleteEntry**

These already exist in `packages/frontend/lib/api.ts`. Import them if not already imported.

- [ ] **Step 3: Add Aula import section**

Inside the popup, after the main event details and before the close/save buttons, add:

```tsx
{entry.aulaItemId && (
  <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
    <div>
      <div className="text-sm font-semibold">Tilføj til familiekalender</div>
      <div className="text-xs text-muted-foreground">Vises i kalender og på forsiden</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={!!entry.calendarImported}  // see step 4
      onClick={handleToggleCalendarImport}
      className={`relative h-6 w-11 rounded-full transition-colors ${entry.calendarImported ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${entry.calendarImported ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  </div>
)}
```

- [ ] **Step 4: Track import state and implement handler**

```typescript
const [importedEntryId, setImportedEntryId] = useState<string | null>(null);

const handleToggleCalendarImport = async () => {
  if (!entry.aulaItemId) return;
  if (importedEntryId) {
    await deleteEntry(importedEntryId);
    setImportedEntryId(null);
  } else {
    const created = await createEntry({
      title: entry.title,
      type: 'event',
      startTime: entry.startTime,
      endTime: entry.endTime,
      allDay: entry.allDay,
      calendarId: entry.calendarId,
      ownerMemberId: entry.ownerMemberId,
      aulaItemId: entry.aulaItemId,
    });
    setImportedEntryId(created.id);
  }
};
```

Update the toggle button's `aria-checked` and visual state to use `!!importedEntryId` instead of `entry.calendarImported`.

Note: `createEntry` will need `aulaItemId` in its request payload. Update `CreateEntryRequest` in `packages/contracts/src/api.ts` to add `aulaItemId?: string`.

- [ ] **Step 5: Update contracts CreateEntryRequest**

In `packages/contracts/src/api.ts`, find `CreateEntryRequest` and add:
```typescript
aulaItemId?: string;
```

In the backend entry creation route in `app.ts`, pass `aulaItemId` through to the repository's create call if present (existing postgres entry repo will need to include it in the INSERT and SELECT).

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/components/entry-details-popup.tsx packages/contracts/src/api.ts packages/backend/src/app.ts
git commit -m "feat(frontend): Aula entry calendar import toggle in entry details popup"
```

---

## Task 13b: Frontend — confirmed badge on I dag lesson blocks

**Files:**
- Modify: `packages/frontend/components/idag-view.tsx`
- Modify: `packages/frontend/components/time-grid.tsx`

Spec §4b: "Confirmed classes gain a small ✓ badge on the I dag block."

- [ ] **Step 1: Load confirmed set in idag-view.tsx**

After loading `aulaLessons`, also load the confirmation set. Add a state:

```typescript
const [confirmedLessonIds, setConfirmedLessonIds] = useState<Set<string>>(new Set());
```

At the end of the `.then((results) => {...})` in the lesson loading effect, add a call to fetch which items are confirmed (the backend annotates `aulaGetItems` responses with `confirmed: true`). Extract those ids:

```typescript
// After setAulaLessons([...flat, ...fallbacks]):
// Items already have confirmed field from the backend — extract from raw fetch results
// (The aulaGetItems results are the annotated items from Task 6 Step 3)
```

Actually, since `aulaGetItems` already returns `confirmed` on each item (from Task 6), capture it during the lesson loading loop:

```typescript
// Inside the child-map loop, after building lessons array, also capture confirmed ids
// Pass them up via the results object: { childId, noSchedule, lessons, confirmedIds: string[] }
// Then at the end: setConfirmedLessonIds(new Set(results.flatMap(r => r.confirmedIds ?? [])));
```

- [ ] **Step 2: Extend AulaLesson with confirmed flag**

In `packages/frontend/components/time-grid.tsx`, the `AulaLesson` interface already exports — add:

```typescript
export interface AulaLesson {
  memberId: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  confirmed?: boolean;  // add this
}
```

Pass `confirmed` when building the lessons array in `idag-view.tsx`:

```typescript
return {
  memberId: child.id,
  title: ...,
  date: todayStr,
  startTime: ...,
  endTime: ...,
  confirmed: confirmedSet.has(itemId),  // set during loop
} as AulaLesson;
```

- [ ] **Step 3: Render ✓ badge in time-grid.tsx**

In `time-grid.tsx`, in the lesson block render section (the striped background div), add a small badge when `lesson.confirmed`:

```tsx
{lesson.confirmed && (
  <span
    className="absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white"
    style={{ background: memberColor }}
  >✓</span>
)}
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add packages/frontend/components/idag-view.tsx packages/frontend/components/time-grid.tsx
git commit -m "feat(frontend): confirmed ✓ badge on I dag lesson blocks"
```

---

## Task 14: Final integration check

- [ ] **Step 1: Run full test suite**

```bash
npm run test:integration
```
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Run linter**

```bash
npm run lint
```
Expected: no errors (fix any that appear)

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: manual weekly schedule — complete implementation"
```
