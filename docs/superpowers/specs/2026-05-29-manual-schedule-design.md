# Manuelt Ugeskema — Design Spec

**Date:** 2026-05-29
**Status:** Approved
**Scope:** Manual weekly school schedule per child member, visible only in I dag view

---

## 1. Goal

Allow families to maintain a manual Mon–Fri school timetable per child that feeds the I dag timeline. Acts as both a permanent alternative to Aula data and an automatic fallback when Aula sync fails or is not set up. Does not affect the main calendar or dashboard.

---

## 2. Entry Point

A 📅 icon is added to each child's member card in the **Familie view** (expandable cards). Tapping it opens the Schedule Editor as a bottom sheet scoped to that member.

Parents also have cards in Familie view but the schedule icon only appears for members with `role = 'child'`.

---

## 3. Schedule Editor Bottom Sheet

### Header
Member avatar, name, and school name (from `members.settings_json.institutionName` if present).

### Aula Toggle
```
┌─────────────────────────────────────────┐
│ Brug Aula-data          [toggle ON/OFF] │
│ Synkroniseret automatisk                │
└─────────────────────────────────────────┘
```
- Default: ON if the family has an active Aula connection, OFF otherwise
- Can be toggled regardless of Aula connection state
- When ON: Aula status line shown ("✓ Aula synkroniseret — N timer denne uge"); manual schedule section visible but greyed out
- When OFF: manual schedule editor becomes fully active

### Schedule Editor (active when toggle OFF)
One section per weekday (Mandag–Fredag). Each day shows:
- Existing class slots: `[Subject name]  [HH:MM–HH:MM]  [✕]`
- ＋ Tilføj time button

**Inline add form** (expands in place when ＋ is tapped):
- Fagnavn text input
- Start time + end time pickers (HH:MM)
- Day-repeat chips: Man · Tir · Ons · Tor · Fre (multi-select — the class is saved to all selected days)
- Gem / Annuller buttons

---

## 4. I dag Display

Manual schedule entries render in the **TimeGrid** component as striped background blocks in the member's colour — identical visual treatment to the existing `AulaLesson` blocks from Aula. They appear only on the matching weekday (Mon–Fri).

Regular calendar events continue to render on top as before.

### Placeholder prompt
If a child's column in I dag has no schedule data (Aula toggle ON but Aula returned nothing, OR toggle OFF with no manual entries), a subtle inline prompt appears in that column:

```
Ingen skemadata
Tilføj manuelt →
```

Tapping the prompt opens the Schedule Editor bottom sheet for that member.

---

## 5. Priority Logic

| Aula toggle | Aula data available | I dag shows |
|---|---|---|
| ON | Yes | Aula data |
| ON | No / failed | Manual schedule (prompt if none) |
| OFF | Either | Manual schedule (prompt if none) |

The toggle state is per-member, not per-family.

---

## 6. Data Model

### New table: `member_schedule`

```sql
CREATE TABLE member_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),  -- 1=Mon
  title        TEXT NOT NULL,
  start_time   TIME NOT NULL,   -- stored as TIME e.g. 08:00
  end_time     TIME NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON member_schedule (family_id, member_id, day_of_week);
```

### Toggle storage
`members.settings_json.use_aula_schedule` (boolean). Default: `true` if the family has an Aula connection, `false` otherwise. Updated via the existing `PATCH /api/v1/members/:id` endpoint (settings_json merge).

---

## 7. Backend

### Migration
`migrations/020_member_schedule.sql` — creates `member_schedule` table.

### New routes (added to `app.ts`)

```
GET    /api/v1/members/:id/schedule
  → list entries for member (scoped to family), ordered by day_of_week, start_time

POST   /api/v1/members/:id/schedule
  body: { dayOfWeek, title, startTime, endTime }
  → insert row, return created entry

DELETE /api/v1/members/:id/schedule/:entryId
  → delete row (verify family ownership)
```

The toggle is updated via the existing `PATCH /api/v1/members/:id` which already merges `settings_json`.

### In-memory repository
`InMemoryMemberScheduleRepository` implements the same interface as the Postgres version. Tests use in-memory (no DB required, consistent with existing approach).

---

## 8. Frontend

### New component: `ScheduleEditor`
`packages/frontend/components/schedule-editor.tsx`

A bottom sheet (uses existing bottom-sheet pattern). Props:
```typescript
interface Props {
  member: Member;
  aulaConnected: boolean;
  onClose: () => void;
}
```

Fetches schedule entries on mount via `GET /api/v1/members/:id/schedule`. Handles add/delete inline. Persists toggle change immediately on flip.

### Familie view member card
`packages/frontend/components/mobile/mobile-family-view.tsx` (or wherever member cards live) — add 📅 icon button for child members. Tap → render `<ScheduleEditor>`.

### `idag-view.tsx` changes
Extend the existing `aulaLessons` loading logic:

```typescript
// After loading Aula items:
if (!useAulaSchedule || aulaLessons.length === 0) {
  const scheduleItems = await fetchMemberSchedule(memberId, today);
  // scheduleItems mapped to AulaLesson shape
}
```

The `fetchMemberSchedule` helper calls `GET /api/v1/members/:id/schedule`, filters to `day_of_week === today.getDay()`, and returns `AulaLesson[]`.

When a child has no schedule data at all (neither Aula nor manual), render the placeholder prompt inline in that child's column — decided and rendered in `idag-view.tsx`, not passed down to TimeGrid.

### `time-grid.tsx`
No structural changes needed — manual schedule entries are mapped to the existing `AulaLesson` interface (`memberId`, `title`, `date`, `startTime`, `endTime`) before being passed in. The component already renders these as striped blocks.

### `lib/api.ts`
Add three typed fetch wrappers:
- `getMemberSchedule(memberId)`
- `createScheduleEntry(memberId, entry)`
- `deleteScheduleEntry(memberId, entryId)`

---

## 9. Aula Entry Isolation (explicit constraint)

Neither `calendar_lesson` nor `weekplan_lesson` Aula items ever appear in the main family calendar (dashboard calendar view or calendar tab) automatically. The sync service's `importToCalendar` flag stays `false` permanently.

### Per-entry opt-in: "Tilføj til familiekalender"

When a user taps an Aula lesson block in the I dag view, the entry detail popup shows a toggle at the bottom:

```
☐  Tilføj til familiekalender
```

Ticking it creates a real `Entry` (type `event`) in the member's primary calendar — same as if the user had created it manually. The Aula item itself is unchanged; the calendar entry is independent. If the user unticks it, the calendar entry is deleted.

**State persistence:** the toggle reflects whether a calendar `Entry` with `aulaItemId = <aula_item.id>` already exists, so it shows as ticked if the user has already imported it.

**Data model addition:** add `aula_item_id UUID REFERENCES aula_items(id)` (nullable) to the `entries` table so imported entries can be traced back to their Aula source. Migration `021_entries_aula_item_id.sql`.

**Scope:** applies to both `calendar_lesson` and `weekplan_lesson` type Aula items. Does not apply to manual schedule entries (those are not Aula items and have no calendar import option).

---

## 10. Out of Scope

- Week grid (Uge mode in I dag) — manual schedule not shown there in this iteration
- Parents' schedule (only child members)
- Reordering / editing existing entries (delete + re-add)
- Export or sync of manual schedule to external calendars
