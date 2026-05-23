# Aula Weekplan — Design Spec

**Date:** 2026-05-23
**Source:** MentalLoad-Issues.md → `[CHANGE] Aula integration` → item 3

## Problem

The Aula "Dagsoverblik" view currently shows `get_daily_overview()` output — a status blob (presence, entry/exit times, comments) that's empty on weekends and not actually a schedule. The user wants it to show **the next school day's timetable** (Mon–Fri), looking like a school schedule.

## Goal

Replace the daily-overview data source with a **weekplan** source that emits one row per lesson per child per day, ready to render as a timetable.

**In scope:** sidecar + backend data flow. No UI change beyond the existing Aula Data tab's incidental rendering.

**Out of scope:** the dedicated school-schedule layout on `/member/[memberId]` (item 4); deleting/refreshing rows on resync (item 2); presence on member cards (item 6); special handling of Danish school holidays (we show whatever Aula returns for the target week — empty days included).

**Note on "next school day":** the user phrased the request as "next school day", but the library's weekplan endpoints work on a *week* basis, not per-day. We fetch the **full target week (Mon–Fri)** — including days that have already passed if today is e.g. Wednesday. Choosing which day to highlight as "next" is a UI concern handled in item 4.

## Architecture

```
Frontend (no UI change yet)
    ↓ GET /api/v1/aula/items?type=weekplan_lesson
Backend (AulaSyncService.runSync)
    ↓ POST /fetch-data { …, fetch_weekplan: true }
Sidecar
    ├─ compute target ISO week (today's if Mon–Fri, else next Mon's)
    ├─ for each child:
    │     try get_meebook_weekplan() → fallback get_easyiq_weekplan() → fallback get_ugeplan()
    │     normalize result to lessons[]
    └─ return weekplan_lessons[]
Backend upserts into aula_items (type='weekplan_lesson')
```

## Sidecar — `/fetch-data` weekplan block

### Target week calculation

```python
today = datetime.now(timezone.utc).date()
if today.weekday() <= 4:           # Mon-Fri (0..4)
    target_monday = today - timedelta(days=today.weekday())
else:                              # Sat-Sun
    target_monday = today + timedelta(days=(7 - today.weekday()))
iso = target_monday.isocalendar()
target_week = f"{iso.year}-W{iso.week:02d}"
```

### Per-child try-all fallback

The `aula` library has three weekplan endpoints depending on which tool the school uses. We try in order: Meebook → EasyIQ → MinUddannelse. First non-empty result wins.

```python
lessons = []
for child in children:
    plan = (
        try_meebook(child, target_week)
        or try_easyiq(child, target_week)
        or try_ugeplan(child, target_week)
    )
    if plan:
        lessons.extend(normalize(plan, child_id=child.id, source=plan["source"]))
```

Each `try_*` helper catches its own exceptions, logs `[fetch-data] weekplan <source> child {id}: <err>`, and returns `None` on failure or empty. The widget/session/institution IDs each endpoint needs are obtained via `get_profile_context()` + `get_widgets()` — both called once at the top of `/fetch-data` and reused per child.

### Normalized lesson shape

```python
{
  "childId":      int,
  "date":         "YYYY-MM-DD",          # one of Mon..Fri in target_week
  "startTime":    "HH:MM" | None,        # EasyIQ has it; Meebook usually doesn't
  "endTime":      "HH:MM" | None,
  "title":        str,                   # lesson name
  "description":  str | None,            # homework / notes
  "source":       "meebook" | "easyiq" | "ugeplan",
}
```

If all three sources fail or return empty for a child, that child gets zero lessons — not treated as an error.

### Response field

`/fetch-data` adds:
```json
"weekplan_lessons": [...]
```
The existing `daily_overviews` field is removed.

## Backend — `AulaSyncService.runSync`

### `aula_items` row mapping

No schema change — reuse existing columns.

| column        | value                                                       |
|---------------|-------------------------------------------------------------|
| `type`        | `'weekplan_lesson'`                                         |
| `aula_id`     | `` `weekplan-${childId}-${date}-${seq}` `` — see seq rule below |
| `title`       | `lesson.title`                                              |
| `body`        | `lesson.description ?? ''`                                  |
| `author`      | `null`                                                      |
| `member_id`   | mapped from `conn.childMappings[childId].mentalLoadMemberId`|
| `published_at`| `` `${date}T${startTime ?? '00:00'}:00Z` ``                 |
| `raw_json`    | full lesson object including `source`, `startTime`, `endTime`|

**`seq` rule:** within a `(childId, date)` group, sort lessons by `(startTime ?? '99:99', title)` and assign `seq = 0..n`. Sorting from sidecar output (not from library iteration order) keeps the id stable across resyncs even if the underlying library returns lessons in different orders.

The existing `ON CONFLICT … DO NOTHING` keeps resyncs cheap. If a lesson's content changes (teacher swap, room change), the row won't update — flagged as a known limitation for item 2 to address with an UPSERT path.

### Removing daily overview handling

The `daily_overviews` branch in `runSync` is deleted. The 2 existing rows in DB stay (dead data). Item 2 will give the user a button to clear them.

### Sync option flag

`AulaSyncOptions.dailyOverview` is repurposed — same field name, same UI label ("Dagsoverblik"), but now drives weekplan fetching. Sidecar request body sends `fetch_weekplan: req.syncOptions.dailyOverview` (internal rename in the request builder only; contract unchanged).

## Error handling

**Sidecar**
- Per-child library calls wrapped; per-source library calls wrapped. Failures are logged and continue.
- `get_profile_context()` / `get_widgets()` failure aborts only the weekplan block; messages and other fetches still run.

**Backend**
- `upsertAulaItem` already returns `false` on conflict or `Date.parse` rejection — that defense-in-depth covers any odd date the sidecar emits.
- Any unexpected throw propagates through `runSync` → 502 → UI toast (existing plumbing).

**Auth expiry mid-fetch**
- Library 401/403 on weekplan calls is logged silently. The existing messages flow remains responsible for detecting auth expiry and signalling reconnect.

## Testing

Mostly manual verification — mocking a Python library wrapper would test the mock, not the integration.

1. Deploy. Hit "Synkroniser nu". Check sidecar logs for `[fetch-data] lessons=<n>` per child.
2. SQL: `select raw_json->>'source' as src, count(*) from aula_items where type='weekplan_lesson' group by src;` — tells us which library actually returned data.
3. The Aula Data tab will incidentally show the rows (existing grouping by child).

If no source returns data, the three `[fetch-data] weekplan <source>` log lines per child give us the diagnostic.

## Open follow-ups (intentionally deferred)

- **Item 2** — deleteable / refresh-on-resync semantics. Will require switching from `DO NOTHING` to `DO UPDATE` plus a `hidden_at` column.
- **Item 4** — render the `weekplan_lesson` rows as a school-schedule grid on `/member/[memberId]`.
- **Calendar 403** (open from prior session) — unrelated to this spec; not blocking.
