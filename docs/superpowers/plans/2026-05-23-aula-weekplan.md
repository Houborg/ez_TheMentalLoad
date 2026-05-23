# Aula Weekplan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily-overview Aula data flow with a weekplan flow — one `aula_items` row per lesson per child per day, sourced from Meebook → EasyIQ → MinUddannelse fallback.

**Architecture:** Python sidecar's `/fetch-data` adds a weekplan block that computes the target ISO week (today's if Mon–Fri, else next Mon's), iterates each child through the three weekplan endpoints, and returns a normalized lessons array. Backend `AulaSyncService` deletes its daily-overview branch and inserts the lessons as `weekplan_lesson` rows.

**Tech Stack:** Python 3.14 + FastAPI + `aula` library (sidecar); TypeScript + Fastify + pg (backend).

**Spec:** [docs/superpowers/specs/2026-05-23-aula-weekplan-design.md](../specs/2026-05-23-aula-weekplan-design.md)

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/aula-sidecar/main.py` | Modify | `/fetch-data` weekplan block + helpers (target-week, normalization, source fallback) |
| `packages/backend/src/aula/aula-sync-service.ts` | Modify | Remove daily-overview branch; add weekplan_lesson insert branch; rename request field |
| `docs/superpowers/aula-handoff-2026-05-23.md` | Modify | Mark calendar-403/posts-0 still open; record that daily_overview → weekplan_lesson |

No new files. No schema migration (reuses existing `aula_items` columns).

---

## Task 1: Probe profile context shape

The three weekplan endpoints need `session_uuid`, `institution_filter`, `child_filter` (unilogin per child), and for Ugeplan also `widget_id`. The `aula` library exposes these via `get_profile_context()` (a dict) and `get_widgets()` (typed). Their exact shape is not documented — we need to discover it in production once and lock the field paths into the code.

**Files:**
- Modify: `packages/aula-sidecar/main.py` (temporary probe endpoint, removed after Task 2)

- [ ] **Step 1: Add a temporary `/probe` endpoint to the sidecar**

Add this above the existing `@app.get("/health")` handler (so it's served before health). It dumps the raw structures so we can inspect:

```python
@app.post("/probe")
async def probe(req: FetchDataRequest) -> dict:
    """TEMPORARY — inspect get_profile_context() + get_widgets() shape."""
    client = await create_client(req.token_data)
    try:
        ctx = await client.get_profile_context()
        widgets = await client.get_widgets()
        widgets_summary = [
            {"widget_id": w.widget_id, "name": w.name, "supplier": w.widget_supplier, "type": w.widget_type}
            for w in widgets
        ]
        return {"context": ctx, "widgets": widgets_summary}
    finally:
        await client.close()
```

- [ ] **Step 2: Rebuild + restart only the sidecar**

```bash
ssh mhouborg@192.168.1.252 "docker exec testbench-webhook git -C /repo/TestBench/data/apps/mentalload/source pull origin main && docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload build aula-sidecar && docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d aula-sidecar"
```

Expected: `Container mentalload-aula-sidecar Started`.

- [ ] **Step 3: Capture the connection's token_data + invoke the probe**

Use the live token blob already in the DB:

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-postgres psql -U postgres -d mental_load -t -c \"select settings_json->'aula_connection'->'tokenData' from families where settings_json->'aula_connection' is not null limit 1;\" | jq -c '{token_data: ., child_ids: [], from_date: \"\", to_date: \"\", fetch_posts: false, fetch_messages: false, fetch_daily_overview: false}' | docker exec -i mentalload-aula-sidecar curl -s -X POST -H 'Content-Type: application/json' -d @- http://127.0.0.1:8765/probe" | jq .
```

Expected: a JSON object with `context.<…>` and `widgets[]`. Record:
- Where is `session_uuid` / `sessionUUID` inside `context`?
- Where are `institutionProfile.institutionCode` or institution IDs?
- Where is each child's `unilogin`?
- Which `widget_id` does the Meebook supplier use? EasyIQ? MinUddannelse?

Write the answers as a comment block at the top of the weekplan section in `main.py` (added in Task 3) so future readers see the contract.

- [ ] **Step 4: Remove the `/probe` endpoint**

Delete the handler added in Step 1. It is one-shot diagnostic; not committed to main.

- [ ] **Step 5: Commit nothing**

This task produces only knowledge, no committed code. Move on to Task 2.

---

## Task 2: Sidecar — target-week helper + normalized lesson type

The week selection logic and the lesson dict shape are independent of which library endpoint produced the data. Build them first.

**Files:**
- Modify: `packages/aula-sidecar/main.py` (add helpers above `fetch_data`)

- [ ] **Step 1: Add the target-week helper**

Find the existing `_iso_or_none` helper (lines ~355). Add immediately below:

```python
def _target_week_iso() -> tuple[str, "date"]:
    """Return ('YYYY-Wnn', monday_date) for the relevant school week.

    Mon-Fri  → current week.
    Sat-Sun  → next week (so we always show an upcoming school week, never weekend dead-air).
    """
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    if today.weekday() <= 4:  # 0=Mon..4=Fri
        monday = today - timedelta(days=today.weekday())
    else:
        monday = today + timedelta(days=(7 - today.weekday()))
    iso = monday.isocalendar()
    return f"{iso.year}-W{iso.week:02d}", monday
```

Also add the import at the top of the file if not present:
```python
from datetime import date
```

- [ ] **Step 2: Add the lesson normalization helper**

Below `_target_week_iso`, add:

```python
def _normalize_lessons(child_id: int, source: str, lessons_raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert source-specific lesson dicts into the canonical sidecar shape.

    Input items are already pre-shaped by the source-specific fetch helpers
    (Task 3) — this just sorts and assigns the seq field.

    Sort key within (childId, date): (startTime ?? '99:99', title) — keeps
    aula_id stable across resyncs regardless of library iteration order.
    """
    by_day: dict[str, list[dict[str, Any]]] = {}
    for lesson in lessons_raw:
        by_day.setdefault(lesson["date"], []).append(lesson)

    out: list[dict[str, Any]] = []
    for day, items in by_day.items():
        items.sort(key=lambda x: (x.get("startTime") or "99:99", x.get("title") or ""))
        for seq, l in enumerate(items):
            out.append({
                "childId": child_id,
                "date": day,
                "startTime": l.get("startTime"),
                "endTime": l.get("endTime"),
                "title": l.get("title") or "",
                "description": l.get("description"),
                "source": source,
                "seq": seq,
            })
    return out
```

- [ ] **Step 3: Manual sanity check the helpers**

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-aula-sidecar python3 -c \"
import sys; sys.path.insert(0, '/app')
exec(open('/app/main.py').read().split('app = FastAPI()')[0])  # load helpers, skip app init
print(_target_week_iso())
print(_normalize_lessons(123, 'meebook', [
  {'date': '2026-05-25', 'title': 'Mat', 'startTime': '08:15'},
  {'date': '2026-05-25', 'title': 'Eng', 'startTime': '09:00'},
  {'date': '2026-05-26', 'title': 'Sci'},
]))
\""
```

Expected: a tuple like `('2026-W22', datetime.date(2026, 5, 25))` (date depends on when run) and 3 normalized lessons with `seq` values `0,1,0` respectively.

- [ ] **Step 4: Commit**

```bash
git add packages/aula-sidecar/main.py
git commit -m "feat(aula-sidecar): add target-week + lesson normalization helpers"
```

---

## Task 3: Sidecar — source-specific fetchers (Meebook / EasyIQ / Ugeplan)

Each library endpoint has its own parameter shape and result type. Each fetcher catches its own exceptions and returns a pre-normalized list (`{date, title, startTime?, endTime?, description?}`) or empty.

**Files:**
- Modify: `packages/aula-sidecar/main.py` (add helpers below normalization)

- [ ] **Step 1: Add the contract comment + helpers**

**Discovered context contract (Task 1 probe, 2026-05-23 against Englystskolen):**
- `profile_context["data"]["userId"]` → session_uuid (str)
- `Profile.children[i]._raw["userId"]` → unilogin per child (e.g. `"emil59r3"`)
- `Profile.children[i]._raw["institutionProfile"]["institutionCode"]` → institution code per child (e.g. `"603005"`)
- Multiple widgets share the same supplier (UVDATA hosts SSO, Ugenoter, Opgaver, Meddelelsesbog). Match widgets by NAME substring, not supplier.

Insert below `_normalize_lessons`:

```python
# ── Weekplan source-specific fetchers ───────────────────────────────────────
#
# Profile context contract (probed 2026-05-23):
#   profile_context["data"]["userId"]                                  → session_uuid (str)
#   client.get_profile().children[i]._raw["userId"]                    → unilogin per child
#   client.get_profile().children[i]._raw["institutionProfile"]
#                       ["institutionCode"]                            → institution code per child
#
# Widgets are matched by name (case-insensitive substring) since multiple
# widgets can share a supplier (UVDATA has several MinUddannelse widgets).
#
# If the library API changes and any of these paths break, the per-source
# fetcher catches the KeyError/AttributeError and returns [].

async def _resolve_session_and_filters(client: Any) -> dict[str, Any] | None:
    """Pull session_uuid, institution_filter, child unilogins, widget_ids in one shot.

    Returns None if the context can't be loaded — caller skips the whole weekplan block.
    """
    try:
        profile = await client.get_profile()
        profile_context = await client.get_profile_context()
        widgets = await client.get_widgets()
    except Exception as e:
        print(f"[fetch-data] weekplan: cannot load profile context: {e}", flush=True)
        return None

    try:
        session_uuid = profile_context["data"]["userId"]
    except (KeyError, TypeError) as e:
        print(f"[fetch-data] weekplan: session_uuid missing from profile_context: {e}", flush=True)
        return None

    institution_codes: list[str] = []
    unilogin_by_child_id: dict[int, str] = {}
    for child in profile.children or []:
        raw = child._raw or {}
        unilogin = raw.get("userId", "")
        if unilogin:
            unilogin_by_child_id[int(child.id)] = unilogin
        inst_code = raw.get("institutionProfile", {}).get("institutionCode", "")
        if inst_code and str(inst_code) not in institution_codes:
            institution_codes.append(str(inst_code))

    # Match widgets by name substring (case-insensitive)
    def widget_id_by_name_match(*needles: str) -> str | None:
        for w in widgets:
            name = (w.name or "").lower()
            if any(n in name for n in needles):
                return w.widget_id
        return None

    widget_id_by_kind = {
        "meebook": widget_id_by_name_match("meebook"),
        "easyiq": widget_id_by_name_match("easyiq"),
        "ugeplan": widget_id_by_name_match("ugenoter", "ugeplan"),
    }

    return {
        "session_uuid": session_uuid,
        "institution_filter": institution_codes,
        "unilogin_by_child_id": unilogin_by_child_id,
        "widget_id_by_kind": widget_id_by_kind,
    }


async def _fetch_meebook(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    if not unilogin:
        return []
    try:
        plans = await client.get_meebook_weekplan(
            child_filter=[unilogin],
            institution_filter=ctx["institution_filter"],
            week=week,
            session_uuid=ctx["session_uuid"],
        )
    except Exception as e:
        print(f"[fetch-data] weekplan meebook child {child_id}: {e}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for plan in plans or []:
        for day in plan.week_plan or []:
            for task in day.tasks or []:
                out.append({
                    "date": day.date,
                    "title": task.title or task.type,
                    "description": task.content or None,
                    # Meebook does not carry per-lesson times
                })
    return out


async def _fetch_easyiq(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    if not unilogin:
        return []
    try:
        appts = await client.get_easyiq_weekplan(
            week=week,
            session_uuid=ctx["session_uuid"],
            institution_filter=ctx["institution_filter"],
            child_id=unilogin,
        )
    except Exception as e:
        print(f"[fetch-data] weekplan easyiq child {child_id}: {e}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for a in appts or []:
        start = a.start or ""
        end = a.end or ""
        if "T" in start:
            date_part, _, start_time = start.partition("T")
        else:
            date_part, start_time = start[:10], ""
        if "T" in end:
            _, _, end_time = end.partition("T")
        else:
            end_time = ""
        out.append({
            "date": date_part,
            "startTime": start_time[:5] if start_time else None,
            "endTime": end_time[:5] if end_time else None,
            "title": a.title or "",
            "description": a.description or None,
        })
    return out


async def _fetch_ugeplan(client: Any, ctx: dict[str, Any], child_id: int, week: str) -> list[dict[str, Any]]:
    unilogin = ctx["unilogin_by_child_id"].get(child_id)
    widget_id = ctx["widget_id_by_kind"].get("ugeplan")
    if not (unilogin and widget_id):
        return []
    try:
        persons = await client.get_ugeplan(
            widget_id=widget_id,
            child_filter=[unilogin],
            institution_filter=ctx["institution_filter"],
            week=week,
            session_uuid=ctx["session_uuid"],
        )
    except Exception as e:
        print(f"[fetch-data] weekplan ugeplan child {child_id}: {e}", flush=True)
        return []
    # MUWeeklyPerson does not expose structured lessons — only a weekly letter blob.
    # Treat the whole weekly letter as a single "lesson" tagged for Monday of the target week.
    # target_monday_iso is added to ctx by the caller in Task 4 (NOT here).
    out: list[dict[str, Any]] = []
    target_monday_iso = ctx["target_monday_iso"]
    for p in persons or []:
        raw = p._raw or {}
        body = raw.get("indhold") or raw.get("content") or ""
        if body:
            out.append({
                "date": target_monday_iso,
                "title": "Ugeplan (MinUddannelse)",
                "description": body,
            })
    return out
```

- [ ] **Step 2: Run the typecheck (Python's `py_compile` as a smoke check)**

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-aula-sidecar python3 -m py_compile /app/main.py && echo ok"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/aula-sidecar/main.py
git commit -m "feat(aula-sidecar): per-source weekplan fetchers (meebook/easyiq/ugeplan)"
```

---

## Task 4: Sidecar — wire weekplan into `/fetch-data`; remove daily overview

**Files:**
- Modify: `packages/aula-sidecar/main.py` (`FetchDataRequest` model + `fetch_data` body)

- [ ] **Step 1: Update the request model**

Replace `fetch_daily_overview: bool = True` with:

```python
    fetch_weekplan: bool = True
```

- [ ] **Step 2: Replace the daily-overview block in `fetch_data`**

In `fetch_data`, find the block that begins with:
```python
        # Daily overview — library is per-child, returns single overview or None.
```
…and ends right before the `# Posts` comment. Replace the entire block with:

```python
        # Weekplan — replaces daily_overview (item 3 from MentalLoad-Issues)
        if req.fetch_weekplan and req.child_ids:
            week, monday = _target_week_iso()
            ctx_extras = await _resolve_session_and_filters(client)
            if ctx_extras is None:
                print("[fetch-data] weekplan: skipped (no profile context)", flush=True)
            else:
                ctx_extras["target_monday_iso"] = monday.isoformat()
                for child_id in req.child_ids:
                    for source_name, fetcher in (
                        ("meebook", _fetch_meebook),
                        ("easyiq", _fetch_easyiq),
                        ("ugeplan", _fetch_ugeplan),
                    ):
                        lessons_raw = await fetcher(client, ctx_extras, child_id, week)
                        if lessons_raw:
                            result["weekplan_lessons"].extend(
                                _normalize_lessons(child_id, source_name, lessons_raw)
                            )
                            break
```

- [ ] **Step 3: Initialize `weekplan_lessons` in the result dict**

At the top of `fetch_data` where `result` is built, replace:
```python
        result: dict[str, Any] = {
            "calendar_events": [],
            "daily_overviews": [],
            "posts": [],
            "messages": [],
        }
```
with:
```python
        result: dict[str, Any] = {
            "calendar_events": [],
            "weekplan_lessons": [],
            "posts": [],
            "messages": [],
        }
```

- [ ] **Step 4: Update the summary log line**

Find:
```python
        print(f"[fetch-data] events={len(result['calendar_events'])} overviews={len(result['daily_overviews'])} posts={len(result['posts'])} msgs={len(result['messages'])}", flush=True)
```
Replace with:
```python
        print(f"[fetch-data] events={len(result['calendar_events'])} weekplan={len(result['weekplan_lessons'])} posts={len(result['posts'])} msgs={len(result['messages'])}", flush=True)
```

- [ ] **Step 5: Smoke compile**

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-aula-sidecar python3 -m py_compile /app/main.py && echo ok"
```

Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add packages/aula-sidecar/main.py
git commit -m "feat(aula-sidecar): /fetch-data returns weekplan_lessons; daily_overviews removed"
```

---

## Task 5: Backend — drop daily-overview branch, rename request field

**Files:**
- Modify: `packages/backend/src/aula/aula-sync-service.ts` (lines 47-51 type, 86 body field, 99-104 response type, 123-138 branch)

- [ ] **Step 1: Remove the `SidecarOverview` interface and add `SidecarWeekplanLesson`**

Replace lines 47-51 (`interface SidecarOverview { … }`) with:

```ts
interface SidecarWeekplanLesson {
  childId: number;
  date: string;            // 'YYYY-MM-DD'
  startTime?: string | null;
  endTime?: string | null;
  title: string;
  description?: string | null;
  source: 'meebook' | 'easyiq' | 'ugeplan';
  seq: number;
}
```

- [ ] **Step 2: Rename the request field**

In the `fetch` call body (around line 86), replace:
```ts
          fetch_daily_overview: conn.syncOptions.dailyOverview,
```
with:
```ts
          fetch_weekplan: conn.syncOptions.dailyOverview,
```

(The frontend toggle's user-facing label stays "Dagsoverblik"; only the wire field renames.)

- [ ] **Step 3: Update the response type**

Replace the `data` typing (around lines 99-104):
```ts
      const data = await res.json() as {
        calendar_events: SidecarEvent[];
        daily_overviews: SidecarOverview[];
        posts: SidecarPost[];
        messages: SidecarMessage[];
      };
```
with:
```ts
      const data = await res.json() as {
        calendar_events: SidecarEvent[];
        weekplan_lessons: SidecarWeekplanLesson[];
        posts: SidecarPost[];
        messages: SidecarMessage[];
      };
```

- [ ] **Step 4: Replace the daily-overview insert branch**

Replace the entire `// Daily overviews → aula_items` block (lines 123-138) with:

```ts
      // Weekplan lessons → aula_items (one row per lesson per child per day)
      if (conn.syncOptions.dailyOverview) {
        for (const lesson of data.weekplan_lessons) {
          const mapping = conn.childMappings.find(m => m.aulaChildId === lesson.childId);
          if (!mapping) continue;
          const aulaId = `weekplan-${lesson.childId}-${lesson.date}-${lesson.seq}`;
          const startTime = lesson.startTime ?? '00:00';
          const publishedAt = `${lesson.date}T${startTime}:00Z`;
          const inserted = await this.upsertAulaItem({
            aulaId,
            type: 'weekplan_lesson',
            title: lesson.title,
            body: lesson.description ?? '',
            memberId: mapping.mentalLoadMemberId,
            publishedAt,
            rawJson: lesson,
          });
          if (inserted) itemsCreated++;
        }
      }
```

- [ ] **Step 5: Run typecheck**

```bash
npm --workspace @mental-load/backend run typecheck
```

Expected: passes silently with no errors.

- [ ] **Step 6: Run existing integration tests to confirm we didn't break anything**

```bash
npm run test:integration
```

Expected: all green. (No tests cover `aula-sync-service`, but other Aula-touching tests must still pass.)

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/aula/aula-sync-service.ts
git commit -m "feat(aula-sync): consume weekplan_lessons; drop daily_overviews"
```

---

## Task 6: Deploy + manual verification

**Files:**
- Read only: server logs, DB state.

- [ ] **Step 1: Push the branch**

```bash
git push origin main
```

Expected: `main -> main` fast-forward.

- [ ] **Step 2: Pull, build, restart sidecar + backend on the server**

```bash
ssh mhouborg@192.168.1.252 "docker exec testbench-webhook git -C /repo/TestBench/data/apps/mentalload/source pull origin main && docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload build aula-sidecar backend && docker compose -f ~/testbench/TestBench/data/apps/mentalload/docker-compose.yml -p mentalload up -d aula-sidecar backend"
```

Expected: both services rebuild and restart; sidecar healthy.

- [ ] **Step 3: Trigger a sync (have the user click "Synkroniser nu" OR call the API directly)**

Manual via UI is fine. If scripted, an authenticated POST to `/api/v1/aula/sync` is needed; the easiest path is to have the user click the button while you tail logs.

```bash
ssh mhouborg@192.168.1.252 "docker logs --tail 30 -f mentalload-aula-sidecar 2>&1 | grep --line-buffered -E 'fetch-data|weekplan'"
```

Expected log line: `[fetch-data] events=0 weekplan=<N> posts=… msgs=…` with `N > 0`.

- [ ] **Step 4: Confirm DB rows landed**

```bash
ssh mhouborg@192.168.1.252 "docker exec mentalload-postgres psql -U postgres -d mental_load -c \"select raw_json->>'source' as src, count(*) from aula_items where type='weekplan_lesson' group by 1;\""
```

Expected: a non-empty result with one of `meebook`, `easyiq`, `ugeplan` and a count.

- [ ] **Step 5: Confirm idempotency — sync again, count should not change**

```bash
# Have the user click "Synkroniser nu" again, then:
ssh mhouborg@192.168.1.252 "docker exec mentalload-postgres psql -U postgres -d mental_load -c \"select type, count(*) from aula_items where type='weekplan_lesson';\""
```

Expected: count identical to Step 4 (ON CONFLICT DO NOTHING + content-sorted seq keeps the ids stable).

- [ ] **Step 6: Update the handoff doc**

Open `docs/superpowers/aula-handoff-2026-05-23.md`, in the "What's still broken" / "Resume state" section, mark item 3 as ✅ and note the new known state (calendar-403 and posts-0 unchanged; `daily_overview` rows in DB are dead data awaiting item 2).

- [ ] **Step 7: Final commit (handoff doc)**

```bash
git add docs/superpowers/aula-handoff-2026-05-23.md
git commit -m "docs(aula-handoff): item 3 (weekplan) shipped"
git push origin main
```

---

## Self-review notes (already applied)

- Spec coverage: every spec section (target-week logic, fallback chain, lesson shape, aula_id seq rule, sync option reuse, error handling, deferred items) has a corresponding task. ✓
- Placeholder scan: Task 3 contains `<DISCOVERED_KEY>` markers — the engineer MUST fill these from Task 1's probe output before committing. This is intentional and called out in the step. ✓
- Type consistency: `SidecarWeekplanLesson` fields match what `_normalize_lessons` emits (childId, date, startTime?, endTime?, title, description?, source, seq). ✓
- Naming: backend wire field renamed to `fetch_weekplan` everywhere; user-facing `dailyOverview` flag preserved. ✓
