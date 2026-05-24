# Aula items 2, 4, 5, 6 — Design

**Date:** 2026-05-24
**Status:** Approved (brainstorming complete, plan pending)
**Related specs:** [2026-05-22-aula-integration-design.md](2026-05-22-aula-integration-design.md), [2026-05-23-aula-weekplan-design.md](2026-05-23-aula-weekplan-design.md)
**Tracked issues:** items 2, 4, 5, 6 in `MentalLoad-Issues.md` (Morten's Obsidian vault) under "[CHANGE] Aula intigration (remaining items after 2026-05-23/24 session)"

## Overview

Four loose ends from the Aula integration get bundled into one design:

1. **Item #2** — Slet button on Aula messages, soft-hide that survives resync.
2. **Item #4** — Dagsoverblik (school schedule) on `/member/[memberId]`, rendered as a day-by-day list on mobile and desktop.
3. **Item #5** — MinUddannelse homework, surfaced as a read-only Lektier section on the member page.
4. **Item #6** — Presence status (tilstede / hentet / syg / …) on the member page header and on dashboard member cards.

All four reuse the existing `aula_items` table, the existing Python sidecar, and the existing 60-min sync worker. No new tables, no new pipelines.

## Decisions captured during brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Scope of "dismiss" | Generic `hidden_at` column on every aula_items type, UI button on messages only for now. |
| 2 | Button wording | "Slet". Implemented as soft-hide so resync respects it. No "Vis skjulte" UI. |
| 3 | Dagsoverblik time window | This school week (Mon–Fri) with `‹ ›` week navigation. |
| 4 | Schedule layout shape | Day-by-day list (not a timetable grid). |
| 5 | Lesson click behaviour | Bottom sheet on mobile / popup on desktop with sanitized HTML body + start/end time. |
| 6 | MU homework treatment | Read-only Aula mirror as new `mu_task` type. No auto-import as MentalLoad tasks. |
| 7 | Presence placement | Dashboard member-card badge + member page header pill. |
| 8 | Storage shape | Reuse `aula_items` for both `mu_task` and `presence`. Same 60-min sync cadence. |

## Non-goals

Explicitly out of scope for this spec:

- The two open Aula data bugs: calendar 403 (`get_calendar_events()` returns 403 per child) and posts-returning-0. Tracked as separate items in `MentalLoad-Issues.md`.
- Auto-importing MU homework as MentalLoad `entries` rows. Rejected in Q6 in favour of the simpler read-only mirror; can be revisited once we've seen the real data.
- Bulk dismiss UI or "Vis skjulte" toggle for hidden messages. Recovery is a DB query.
- Slet button on `post`, `weekplan_lesson`, `mu_task`, `presence` — even though the column supports it. Adding the button on those types is a one-line frontend change later.
- Writing presence, status, or task completion back to Aula. Read-only mirror in all directions.
- Timetable grid (rejected in Q4 — data is naturally weekly-textual, not period-gridded).
- E2E coverage. Aula is hard to fixture end-to-end (sidecar + token). Manual smoke on Testbench is the verification gate.

## Backend

### Migration `015_aula_items_extend.sql`

```sql
alter table aula_items drop constraint if exists aula_items_type_check;
alter table aula_items add constraint aula_items_type_check
  check (type in ('post','message','daily_overview','weekplan_lesson','mu_task','presence'));

alter table aula_items add column if not exists hidden_at timestamptz;

create index if not exists idx_aula_items_member_type_pub
  on aula_items(family_id, member_id, type, published_at desc);
```

- `hidden_at` is the soft-hide column (item #2). Listing endpoint filters `hidden_at IS NULL` by default.
- `mu_task` and `presence` are the new types (items #5, #6).
- Composite index supports per-member-per-type queries the member page issues.
- Existing dead `daily_overview` rows are left untouched. They will never surface in any UI because no caller queries them.

### `AulaSyncOptions` additions

```ts
// packages/backend/src/aula/aula-types.ts
export interface AulaSyncOptions {
  importToCalendar: boolean;
  calendarEvents: boolean;
  dailyOverview: boolean;
  posts: boolean;
  messages: boolean;
  mu_tasks: boolean;   // NEW — default true after migration
  presence: boolean;   // NEW — default true after migration
}
```

Migration `015` backfill: `update aula_connections set sync_options = sync_options || '{"mu_tasks":true,"presence":true}'::jsonb` (or equivalent path through `AulaConnectionService`, depending on where `sync_options` is persisted — verify before writing the SQL).

### Sidecar `/fetch-data` contract additions

Request body gains two boolean flags:

```json
{ "fetch_mu_tasks": true, "fetch_presence": true }
```

Response body gains two arrays. Field names are the *contract* — sidecar's Python implementation maps the `aula` library's actual attribute names to these names (introspect via `inspect.signature` and `dataclasses.fields` from inside the running container, same approach as the weekplan work in `2026-05-23-aula-weekplan-design.md`).

```json
{
  "mu_tasks": [
    {
      "childId": 12345,
      "id": "mu-task-uuid-or-int",
      "title": "Læs side 12-15",
      "subject": "Dansk",
      "dueDate": "2026-05-28",
      "description": "<p>Læs og forbered…</p>",
      "status": "open",
      "url": "https://www.minuddannelse.net/..."
    }
  ],
  "presence": [
    {
      "childId": 12345,
      "status": "tilstede",
      "statusLabel": "Tilstede",
      "entryTime": "08:02",
      "exitTime": null,
      "comment": null,
      "asOf": "2026-05-24T12:00:00+02:00"
    }
  ]
}
```

Status code domain (from `get_presence_states`, library docs to confirm): `tilstede | ikke_ankommet | hentet | syg | ferie | fri`. Any unknown status passes through as `status_label` text only; the frontend renders an unknown status as a neutral slate pill.

### Sync service changes

`packages/backend/src/aula/aula-sync-service.ts`:

1. Pass the two new flags to the sidecar:
   ```ts
   fetch_mu_tasks: conn.syncOptions.mu_tasks,
   fetch_presence: conn.syncOptions.presence,
   ```
2. Process the two new arrays:
   - `mu_tasks` → loop, find child mapping, call `upsertAulaItem` with `type: 'mu_task'`, `aulaId: 'mu-' + task.id`, `title`, `body: description`, `publishedAt: dueDate`, `memberId: mapping.mentalLoadMemberId`, `rawJson: task`. Uses **insertIfNew** mode — homework tasks don't change once published.
   - `presence` → loop, find child mapping, call `upsertAulaItem` with `type: 'presence'`, **`aulaId: 'presence-' + childId`** (deterministic, one row per child forever), `title: status`, `body: statusLabel + (entryTime ? " — kom kl. " + entryTime : "")`, `publishedAt: asOf`, `memberId: mapping.mentalLoadMemberId`, `rawJson: presence`. Uses **upsertOverwrite** mode — overwrites the row on every sync.
3. Split `upsertAulaItem` into two modes via a `mode: 'insert' | 'upsert'` flag. `'insert'` keeps today's `on conflict do nothing`; `'upsert'` switches to `on conflict (family_id, aula_id, type) do update set title = excluded.title, body = excluded.body, author = excluded.author, published_at = excluded.published_at, raw_json = excluded.raw_json` (does not touch `hidden_at` — if a user hid a row, sync must not un-hide it).
4. `lastSyncStats.itemsCreated` keeps its current semantics (count of newly inserted rows). Presence rows after the first sync are updates, not inserts, so they don't bump the counter — that's correct.

### API additions

`packages/backend/src/aula/aula-routes.ts`:

- **`DELETE /api/v1/aula/items/:id`** — sets `hidden_at = now()` on the matching row scoped to the caller's `family_id`. Returns `200 { ok: true }` on success, `404` if no row matches (either non-existent or different family). No body.
- **`GET /api/v1/aula/items`** — existing endpoint, now filters `hidden_at IS NULL` by default. Add `?include_hidden=1` (any truthy value) to bypass the filter (kept for ops/debugging, not surfaced in UI).

### Dashboard snapshot extension

`packages/backend/src/app.ts` `loadDashboardSnapshot` response gains:

```ts
presence: Record<string /* memberId */, AulaPresence | null>
```

Backed by a single query: `select member_id, raw_json from aula_items where family_id = $1 and type = 'presence' and hidden_at is null`. Result reshaped into the record. Members without a presence row map to `null` (or are absent from the record — frontend treats both as "no badge").

### WebSocket event

`packages/backend/src/events/domain-event-bus.ts` adds:

```ts
'aula.presence.updated': { memberId: string; presence: AulaPresence }
```

Emitted from the sync service after the presence upsert loop. The frontend subscribes in `dashboard-app.tsx` to refresh the badges in real-time without a re-fetch.

## Frontend

### `lib/aula-api.ts` additions

```ts
export async function aulaDeleteItem(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/aula/items/${id}`, { method: 'DELETE' });
}
```

(The `aulaGetItems` function already exists and accepts a `type` filter.)

### Shared types in `@mental-load/contracts`

```ts
// packages/contracts/domain.d.ts
export type AulaPresenceStatus =
  | 'tilstede' | 'ikke_ankommet' | 'hentet' | 'syg' | 'ferie' | 'fri';

export interface AulaPresence {
  status: AulaPresenceStatus | string;  // unknown statuses passed through
  statusLabel: string;
  entryTime?: string;
  exitTime?: string;
  comment?: string;
  asOf: string;
}

export interface AulaMuTask {
  id: string;
  title: string;
  subject?: string;
  dueDate: string;        // YYYY-MM-DD
  description?: string;   // HTML
  status: 'open' | 'done' | string;
  url?: string;
}

export interface AulaWeekplanLesson {
  childId: number;
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  description?: string;
  source: 'meebook' | 'easyiq' | 'ugeplan';
  seq: number;
}
```

### Item #2 UI

Edit `packages/frontend/components/aula-data-viewer.tsx`:

- `ItemCard` props gain `onDelete?: (id: string) => Promise<void>` (passed only for `type='message'`).
- Renders a trash icon (lucide `Trash2`, `h-3.5 w-3.5`) in the card header next to the timestamp.
- Click → swaps the timestamp area for an inline confirm row: "Slet besked?" + "Ja, slet" (destructive style) + "Annullér". Auto-dismisses after 3 s.
- Confirm → optimistic remove from `items` state, await `aulaDeleteItem`. On error, restore the item and surface a Danish toast.
- No bulk-select, no "Vis skjulte" toggle.

### New components

```
packages/frontend/components/aula/
  member-school-schedule.tsx   # item #4
  member-homework.tsx          # item #5
  member-presence-badge.tsx    # item #6 (member page header)
  member-presence-dot.tsx      # item #6 (dashboard / sidebar)
  lesson-detail-sheet.tsx      # item #4 click target
  mu-task-detail-sheet.tsx     # item #5 click target
```

#### `<MemberSchoolSchedule memberId aulaChildId />`

- Loads `aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 })` on mount and on week change.
- Internal state: `weekStartDate` (Monday in `Europe/Copenhagen`), initialised to current week's Monday.
- Filters items to `published_at` in `[weekStartDate, weekStartDate + 5 days)` (Mon–Fri).
- Groups by date, sorts inside each day by `raw_json.startTime` ascending.
- Header: `‹ Uge {ISOWeek} ›` with chevron buttons either side. (Class name isn't a clean field in the Ugeplan payload — it's embedded in lesson titles like "Ugeplan 1D (Englystskolen)" — so we don't try to render it separately.)
- Body: five day cards (one per weekday). Each card has a `<LessonRow time={raw_json.startTime ?? "—"} title={item.title} onClick={…} />` per lesson.
- Empty weekday: "Ingen lektioner".
- Empty week entirely: "Ingen ugeplan for uge {n}." + "Synkroniser nu" link to Settings → Aula.
- Lesson click → opens `<LessonDetailSheet item={…} />`.
- Non-school members (no `weekplan_lesson` rows after the loader resolves): component returns `null`; the section just doesn't render on the member page.

#### `<MemberHomework memberId />`

- Loads `aulaGetItems({ type: 'mu_task', memberId, pageSize: 100 })`.
- Bins each task by `dueDate` into: **Forfaldne** (past), **Denne uge** (rest of this ISO week), **Senere** (further out), **Færdige** (`status === 'done'`).
- Færdige section is collapsed by default with a `({n}) Færdige ▾` toggle.
- Each row: subject pill (color hash from `subject` for stable colours across renders), title, relative due-date ("i dag", "i morgen", "om 3 dage", "for 2 dage siden"), 1-line body excerpt (HTML stripped to text).
- Click → `<MuTaskDetailSheet task={…} />` — sanitized HTML body + "Åbn i Aula" link when `raw_json.url` is present.
- Empty state: "Ingen lektier registreret for {memberName}."

#### `<MemberPresenceBadge presence />` (header pill)

- Renders one pill matching the status map below. Tap / hover → popover with `"Opdateret kl. {asOf time-of-day}"` + entry/exit times when present.
- `presence === null` ⇒ component returns `null`.

| status          | label             | tailwind colour            |
|-----------------|-------------------|----------------------------|
| `tilstede`      | Tilstede          | `bg-emerald-500/15 text-emerald-700` |
| `ikke_ankommet` | Ikke ankommet     | `bg-amber-500/15 text-amber-700`     |
| `hentet`        | Hentet            | `bg-sky-500/15 text-sky-700`         |
| `syg`           | Syg               | `bg-rose-500/15 text-rose-700`       |
| `ferie`         | Ferie             | `bg-violet-500/15 text-violet-700`   |
| `fri`           | Fri               | `bg-slate-500/15 text-slate-700`     |
| _other_         | `statusLabel`     | slate (same as `fri`)                |

#### `<MemberPresenceDot presence size? />` (dashboard / sidebar dot)

- 8 × 8 px circle (configurable), positioned absolute on top of an avatar (e.g. bottom-right corner with a ring on the parent's background).
- Colour from the same map above (just the solid swatch, no label).
- `presence === null` ⇒ returns `null`.

#### `<LessonDetailSheet item />` and `<MuTaskDetailSheet task />`

- Reuse the existing bottom-sheet pattern from `components/mobile/bottom-sheet.tsx` on mobile.
- On desktop: render inside the existing modal pattern (mirroring `EntryDetailsPopup` chrome).
- Body HTML sanitized via the `SANITIZE_CONFIG` + `cleanAulaHtml` helpers currently inlined in `aula-data-viewer.tsx`. Lift those helpers into `packages/frontend/lib/aula-html.ts` so both viewer and sheets share them.

### Member page layout

`packages/frontend/app/member/[memberId]/page.tsx`:

- Add a `presence` field to the local data-loading `Promise.all`:
  ```ts
  const [snapshot, upcoming, schoolItems, homework, presenceRes] = await Promise.all([
    loadDashboardSnapshot(),
    loadUpcomingOccurrences(30),
    aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 }),
    aulaGetItems({ type: 'mu_task', memberId, pageSize: 100 }),
    aulaGetItems({ type: 'presence', memberId, pageSize: 1 }),
  ]);
  ```
- All three Aula calls catch and resolve to `{ items: [] }` on error so an unconnected family or sidecar outage doesn't kill the page.
- The three new sections render conditionally (`schoolItems.length > 0`, `homework.length > 0`, `presenceRes.items[0]`).

Desktop layout (`md:` and up) becomes a two-column grid:

```
┌──────────────────────────────────────────────────┐
│ Header: avatar · name · role · <PresenceBadge>   │
├──────────────────────────┬───────────────────────┤
│ Calendar (AgendaView)    │ Skoleskema (item #4)  │
├──────────────────────────┼───────────────────────┤
│ Tasks                    │ Lektier (item #5)     │
├──────────────────────────┴───────────────────────┤
│ Today Timeline (full width)                      │
└──────────────────────────────────────────────────┘
```

Mobile (`< md`) — stacked: Header → Calendar → Skoleskema → Tasks → Lektier → Timeline.

### Dashboard

`packages/frontend/components/dashboard-app.tsx`:

- Pull `snapshot.presence` from the dashboard fetch.
- Pass `presenceByMemberId` to `<AppSidebar />` and to any member-chip rendering in the family view.
- Subscribe to `aula.presence.updated` on the existing WebSocket bus; merge into local state on receipt.

`packages/frontend/components/app-sidebar.tsx`:

- New optional prop `presenceByMemberId?: Record<string, AulaPresence | null>`.
- Each member entry renders `<MemberPresenceDot presence={presenceByMemberId?.[member.id]} />` overlaid on the avatar.

`packages/frontend/components/mobile/mobile-more-sheet.tsx` / family list:

- Same pattern: dot on each member avatar.

### Settings

`packages/frontend/components/aula-settings.tsx` (desktop) and `mobile-aula-settings.tsx` (mobile): add two toggle rows in the existing sync-options group.

| Toggle             | Backed by                 |
|--------------------|---------------------------|
| Lektier (MinUddannelse) | `syncOptions.mu_tasks` |
| Tilstedeværelse    | `syncOptions.presence`    |

Helper text under Tilstedeværelse: "Vises som ikoner på familiens medlemmer."

### Aula Data viewer

`components/aula-data-viewer.tsx` filter pills array gains two entries — `mu_task` ("Lektier") and `presence` ("Tilstedeværelse") — with the matching `TYPE_LABELS` and `TYPE_ICONS` entries (`GraduationCap` and `UserCheck` from lucide-react are reasonable picks).

The trash button (item #2) only renders inside `ItemCard` when `item.type === 'message'`.

## Tests

### Backend (`node:test`, in-memory repos)

- `aula-routes.test.ts`:
  - `DELETE /api/v1/aula/items/:id` sets `hidden_at`, returns 200.
  - Hidden row no longer appears in `GET /api/v1/aula/items`.
  - `?include_hidden=1` returns it.
  - DELETE on an id owned by another family returns 404.
- `aula-sync-service.test.ts`:
  - Sidecar response containing `mu_tasks` inserts new rows with `type='mu_task'` and `memberId` derived from `childMappings`.
  - Sidecar response containing `presence` inserts on first call, overwrites on second (`upsertOverwrite` path).
  - Soft-hidden rows are not un-hidden by sync (sync's `do update` clause excludes `hidden_at`).
  - `mu_tasks: false` / `presence: false` skip the respective branches.

### Sidecar (Python)

- `test_fetch_data.py` (new): mock `AulaApiClient.get_mu_tasks` and `get_presence_states`; assert the response JSON shape matches the contract above when the flags are set, and that the arrays are empty when the flags are off.

### Frontend

No automated tests — the component layer has no test scaffolding in this project. Verification is manual on Testbench after deploy.

## Rollout

1. Merge spec + plan to `main`.
2. Apply migration `015` (auto-runs on backend boot).
3. Rebuild + redeploy `mentalload-aula-sidecar`.
4. Rebuild + redeploy `mentalload-backend` and `mentalload-worker`.
5. Rebuild frontend with `--no-cache` (Next.js).
6. Manual smoke on Testbench:
   - "Synkroniser nu" from Settings → Aula.
   - Inspect `aula_items` for new `mu_task` + `presence` rows.
   - Visit `/member/{Nynne}` — Skoleskema, Lektier, presence badge all render.
   - Hit the Slet button on a message in the Aula Data viewer, confirm row disappears, re-sync, confirm row stays hidden.
   - Dashboard sidebar shows presence dots on member avatars.

## Open follow-ups (deferred)

- Aula calendar 403 — `get_calendar_events()` returns 403 for every child; tracked in `MentalLoad-Issues.md`.
- Aula posts return 0 with no error in sidecar logs — tracked in `MentalLoad-Issues.md`.
- "Vis skjulte" UI if soft-hidden messages start being mis-clicked at scale.
- Auto-import MU homework as MentalLoad tasks (the Q6 option C) — revisit after seeing real data shapes.
