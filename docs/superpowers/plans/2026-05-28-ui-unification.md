# UI Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all 5 desktop views under a shared light-theme shell with consistent tokens, redesigned calendars, member column layouts, new I dag / Planner views, and expandable Familie cards.

**Architecture:** All views rendered inside a shared SlimHeader + BottomNav shell in `dashboard-app.tsx`. New views are extracted into dedicated components (`IDagView`, `PlannerView`, `FamilieView`, `MonthCalendar`, `WeatherStrip`). Existing `TimeGrid` and `WeekGrid` kiosk components are reused inside `IDagView`. Light mode becomes the default theme; dark mode remains available via Settings.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, TypeScript. No new dependencies. Node test runner for backend tests only (no frontend unit tests — verify visually after each phase).

---

## File Map

### Create
| File | Purpose |
|---|---|
| `packages/frontend/components/weather-strip.tsx` | Shared 7-day weather strip (used by Hjem + I dag) |
| `packages/frontend/components/month-calendar.tsx` | Full month calendar with spanning multi-member pills |
| `packages/frontend/components/idag-view.tsx` | I dag view — Today/Week toggle, member avatar columns, meal strip |
| `packages/frontend/components/meal-detail-sheet.tsx` | Bottom sheet shown when tapping a meal card |
| `packages/frontend/components/planner-view.tsx` | Planner AI availability finder |
| `packages/frontend/components/familie-view.tsx` | Familie — expandable member cards with task lists |

### Modify
| File | Change |
|---|---|
| `packages/frontend/app/layout.tsx` | Remove `className="dark"` from `<html>` |
| `packages/frontend/app/globals.css` | Update `:root` light-mode tokens to match design |
| `packages/frontend/components/bottom-nav.tsx` | Rename nav keys: `planner→idag`, `timeline→planner`; update labels/icons |
| `packages/frontend/components/dashboard-app.tsx` | Wire new views; load food plan; update nav handler; remove AI section from Hjem; remove old timeline/planner sections |
| `packages/frontend/components/kiosk-planner.tsx` | Replace hardcoded dark colors with CSS tokens |
| `packages/frontend/components/kiosk-top-bar.tsx` | Replace hardcoded dark colors with CSS tokens |
| `packages/frontend/components/time-grid.tsx` | Replace hardcoded dark colors with CSS tokens |
| `packages/frontend/components/week-grid.tsx` | Replace hardcoded dark colors with CSS tokens |
| `packages/frontend/components/today-timeline-board.tsx` | Fix confetti hex colors → CSS chart tokens |

### Delete
| File | Reason |
|---|---|
| `packages/frontend/components/app-sidebar.tsx` | Dead code — never rendered |

---

## Phase 0 — Theme foundation

### Task 1: Switch to light mode default

**Files:**
- Modify: `packages/frontend/app/layout.tsx`
- Modify: `packages/frontend/app/globals.css`

- [ ] **Step 1: Remove forced dark mode from layout**

Edit `packages/frontend/app/layout.tsx`. Change line 17:
```tsx
// Before
<html lang="en" className="dark">

// After
<html lang="en">
```

- [ ] **Step 2: Update light mode CSS tokens in globals.css**

Replace the entire `:root { ... }` block (lines 3–36) with:
```css
:root {
  /* Page & card surfaces */
  --background:           oklch(0.96 0.004 95);   /* warm off-white #f0f0ec */
  --card:                 oklch(1 0 0);            /* white */
  --card-foreground:      oklch(0.13 0.02 260);
  --popover:              oklch(1 0 0);
  --popover-foreground:   oklch(0.13 0.02 260);

  /* Text */
  --foreground:           oklch(0.13 0.02 260);   /* near-black #1a1a2e */
  --muted-foreground:     oklch(0.50 0.01 260);   /* #666 */

  /* Primary accent — blue */
  --primary:              oklch(0.65 0.16 255);   /* #4f8ef7 */
  --primary-foreground:   oklch(1 0 0);

  /* Secondary / muted surfaces */
  --secondary:            oklch(0.94 0.003 95);
  --secondary-foreground: oklch(0.13 0.02 260);
  --muted:                oklch(0.94 0.003 95);
  --accent:               oklch(0.92 0.008 255);  /* --primary-light */
  --accent-foreground:    oklch(0.65 0.16 255);

  /* Borders */
  --border:               oklch(0.90 0.003 95);   /* #e8e8e8 */
  --input:                oklch(0.90 0.003 95);
  --ring:                 oklch(0.65 0.16 255);

  /* Destructive */
  --destructive:          oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.96 0.01 20);

  /* Chart colours (member palette uses hex directly) */
  --chart-1: oklch(0.75 0.12 200);
  --chart-2: oklch(0.70 0.14 160);
  --chart-3: oklch(0.78 0.10 80);
  --chart-4: oklch(0.68 0.15 280);
  --chart-5: oklch(0.72 0.16 30);

  --radius: 0.75rem;
  --sidebar: oklch(0.94 0.003 95);
  --sidebar-foreground: oklch(0.13 0.02 260);
  --sidebar-primary: oklch(0.65 0.16 255);
  --sidebar-primary-foreground: oklch(1 0 0);
  --sidebar-accent: oklch(0.92 0.008 255);
  --sidebar-accent-foreground: oklch(0.65 0.16 255);
  --sidebar-border: oklch(0.90 0.003 95);
}
```

- [ ] **Step 3: Verify app loads without errors**

Run: `npm run dev:frontend`  
Open http://localhost:5173 — app should display in light mode. Check for layout breakage. Fix any obvious issues (dark-mode-only utility classes like `bg-background/40` that now show as near-transparent).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/app/layout.tsx packages/frontend/app/globals.css
git commit -m "feat(ui): switch to light mode default, update CSS tokens"
```

---

## Phase 1 — Shared components

### Task 2: WeatherStrip component

**Files:**
- Create: `packages/frontend/components/weather-strip.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { cn } from '@/lib/utils';
import type { WeatherForecastResponse } from '@/lib/api';

type Props = {
  forecast: WeatherForecastResponse;
};

const DAYS_DA = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];

export function WeatherStrip({ forecast }: Props) {
  const today = new Date().getDay();

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex divide-x divide-border/50">
        {forecast.daily.slice(0, 7).map((day, i) => {
          const isToday = i === 0;
          return (
            <div
              key={day.date}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 px-1 py-2',
                isToday && 'rounded-xl bg-primary/10',
              )}
            >
              <span className={cn('text-[9px] font-bold uppercase', isToday ? 'text-primary' : 'text-muted-foreground')}>
                {DAYS_DA[(today + i) % 7]}
              </span>
              <span className="text-lg leading-none">{day.icon}</span>
              <span className="text-[10px] font-bold text-foreground">
                {Math.round(day.tempMax)}°
              </span>
              <span className="text-[8px] text-muted-foreground">
                {Math.round(day.tempMin)}°
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check WeatherForecastResponse shape**

Run: `grep -n "tempMax\|tempMin\|daily\|WeatherForecast" packages/frontend/lib/api.ts`

If `daily` uses different field names (e.g. `high`/`low` or `max`/`min`), adjust the component above to match. The type is exported from `packages/frontend/lib/api.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/weather-strip.tsx
git commit -m "feat(ui): add shared WeatherStrip component"
```

---

### Task 3: MonthCalendar component

**Files:**
- Create: `packages/frontend/components/month-calendar.tsx`

This is the most complex component. It renders a full monthly calendar with:
- Colored event pills per member
- Multi-member gradient pills
- Multi-day spanning events (cap-start / flat-mid / cap-end)
- Overflow `+N mere` badges
- Selected day highlight

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry, Member } from '@mental-load/contracts';

const DAYS_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

type Props = {
  month: Date;                          // first day of displayed month
  entries: Entry[];                     // all entries to display
  members: Member[];
  memberColorById: Record<string, string>;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

/** Returns YYYY-MM-DD string in local time */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Build a gradient CSS string from 1–4 member colors */
function memberGradient(colors: string[]): string {
  if (colors.length === 1) return colors[0];
  const pct = 100 / colors.length;
  const stops = colors.flatMap((c, i) => {
    const start = i * pct;
    const end = (i + 1) * pct;
    return i === 0 ? [`${c} ${end}%`] : [`${c} ${start}%`, `${c} ${end}%`];
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Returns the Monday of the week containing `d` */
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day);
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

type RenderedEntry = {
  entry: Entry;
  colors: string[];
  startDateStr: string;
  endDateStr: string;   // inclusive last day
  isMultiDay: boolean;
};

export function MonthCalendar({ month, entries, members, memberColorById, selectedDate, onSelectDate, onPrevMonth, onNextMonth }: Props) {
  const memberById = useMemo(
    () => Object.fromEntries(members.map((m) => [m.id, m])),
    [members],
  );

  // Build the 6-week grid starting from Monday of the week containing the 1st of month
  const gridStart = useMemo(() => {
    const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
    return startOfWeek(firstOfMonth);
  }, [month]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const week: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + w * 7 + d);
        week.push(day);
      }
      result.push(week);
    }
    return result;
  }, [gridStart]);

  // Pre-process entries: resolve colors, clamp dates
  const rendered = useMemo<RenderedEntry[]>(() => {
    return entries.map((entry) => {
      const ownerColor = memberColorById[entry.ownerMemberId] ?? '#6d5efc';
      const visibleIds = entry.visibleMemberIds ?? [];
      const allIds = Array.from(new Set([entry.ownerMemberId, ...visibleIds]));
      const colors = allIds.map((id) => memberColorById[id] ?? ownerColor).slice(0, 4);

      const startDate = new Date(entry.startTime);
      const endDate = entry.allDay
        ? new Date(new Date(entry.endTime).getTime() - 1)  // all-day end is exclusive
        : new Date(entry.endTime);

      const startDateStr = toLocalDateStr(startDate);
      const endDateStr = toLocalDateStr(endDate);

      return { entry, colors, startDateStr, endDateStr, isMultiDay: startDateStr !== endDateStr };
    });
  }, [entries, memberColorById]);

  const monthLabel = month.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });
  const selectedStr = toLocalDateStr(selectedDate);

  // Hide the last week row if all days are in next month
  const visibleWeeks = weeks.filter((week, i) => i < 5 || week.some((d) => d.getMonth() === month.getMonth()));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="text-sm font-bold capitalize">{monthLabel}</span>
        <div className="flex gap-1">
          <button type="button" onClick={onPrevMonth} className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={onNextMonth} className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-border/30">
        {DAYS_DA.map((d) => (
          <div key={d} className="py-1.5 text-center text-[9px] font-bold uppercase text-muted-foreground/70">{d}</div>
        ))}
      </div>

      {/* Weeks */}
      {visibleWeeks.map((week, wi) => {
        const weekStartStr = toLocalDateStr(week[0]);
        const weekEndStr = toLocalDateStr(week[6]);

        // Which entries are visible in this week?
        const weekEntries = rendered.filter((r) => r.endDateStr >= weekStartStr && r.startDateStr <= weekEndStr);

        // Per-cell single-day events (non-spanning)
        const singleByDate: Record<string, RenderedEntry[]> = {};
        const spanning = weekEntries.filter((r) => r.isMultiDay);
        weekEntries.filter((r) => !r.isMultiDay).forEach((r) => {
          singleByDate[r.startDateStr] = [...(singleByDate[r.startDateStr] ?? []), r];
        });

        return (
          <div key={weekStartStr} className="relative grid grid-cols-7 border-b border-border/30 last:border-b-0" style={{ minHeight: '72px' }}>
            {week.map((day) => {
              const dayStr = toLocalDateStr(day);
              const isToday = dayStr === toLocalDateStr(new Date());
              const isSelected = dayStr === selectedStr;
              const isCurrentMonth = day.getMonth() === month.getMonth();
              const singles = (singleByDate[dayStr] ?? []).slice(0, 2);
              const singleOverflow = (singleByDate[dayStr] ?? []).length - 2;

              return (
                <div
                  key={dayStr}
                  onClick={() => onSelectDate(day)}
                  className={cn(
                    'border-r border-border/20 last:border-r-0 cursor-pointer px-0.5 pt-1 pb-8',
                    !isCurrentMonth && 'bg-muted/20',
                    isSelected && !isToday && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between px-1 mb-0.5">
                    <span className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                      isToday ? 'bg-foreground text-background' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40',
                    )}>
                      {day.getDate()}
                    </span>
                    {singleOverflow > 0 && (
                      <span className="text-[8px] text-muted-foreground/50 font-medium">+{singleOverflow}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-[2px] px-0.5">
                    {singles.map((r) => (
                      <span
                        key={r.entry.id}
                        className="block truncate rounded-full px-1.5 py-[1px] text-[9px] font-bold text-white leading-tight"
                        style={{ background: memberGradient(r.colors) }}
                        title={r.entry.title}
                      >
                        {r.entry.title}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Spanning event pills — absolutely positioned */}
            {spanning.map((r, si) => {
              const clampedStart = r.startDateStr < weekStartStr ? weekStartStr : r.startDateStr;
              const clampedEnd = r.endDateStr > weekEndStr ? weekEndStr : r.endDateStr;

              const colStart = week.findIndex((d) => toLocalDateStr(d) === clampedStart);
              const colEnd = week.findIndex((d) => toLocalDateStr(d) === clampedEnd);
              if (colStart < 0 || colEnd < 0) return null;

              const isFirstDay = r.startDateStr >= weekStartStr;
              const isLastDay = r.endDateStr <= weekEndStr;
              const spanCols = colEnd - colStart + 1;

              const laneTop = 22 + si * 18; // px from top of cell row

              return (
                <div
                  key={`${r.entry.id}-${wi}`}
                  className="absolute flex items-center overflow-hidden text-[9px] font-bold text-white leading-none cursor-pointer"
                  style={{
                    top: `${laneTop}px`,
                    height: '16px',
                    left: `calc(${colStart}/7 * 100%)`,
                    width: `calc(${spanCols}/7 * 100%)`,
                    background: memberGradient(r.colors),
                    borderRadius: isFirstDay && isLastDay
                      ? '20px'
                      : isFirstDay
                        ? '20px 0 0 20px'
                        : isLastDay
                          ? '0 20px 20px 0'
                          : '0',
                    paddingLeft: isFirstDay ? '8px' : '4px',
                    paddingRight: isLastDay ? '8px' : '0',
                    opacity: isFirstDay ? 1 : 0.85,
                  }}
                  title={r.entry.title}
                >
                  {isFirstDay ? r.entry.title : ''}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Fix any type errors (e.g. `visibleMemberIds` may be missing on some Entry objects — use optional chaining `entry.visibleMemberIds ?? []`).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/month-calendar.tsx
git commit -m "feat(ui): add MonthCalendar with spanning multi-member pills"
```

---

## Phase 2 — Hjem improvements

### Task 4: Wire MonthCalendar + WeatherStrip into Hjem; update Dagsorden and Upcoming

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

This task replaces the inline calendar rendering and AI assistant section inside `dashboard-app.tsx`, and updates Dagsorden to use member columns and Upcoming to use coloured left bars.

- [ ] **Step 1: Add imports to dashboard-app.tsx**

Add after the existing component imports (around line 64):
```tsx
import { MonthCalendar } from '@/components/month-calendar';
import { WeatherStrip } from '@/components/weather-strip';
```

- [ ] **Step 2: Replace the inline weather widget in the Dashboard section**

Find the weather render inside the `activeNav === 'dashboard'` section in dashboard-app.tsx. It currently renders a `<div>` with weather forecast data. Replace it with:
```tsx
{weatherForecast && (
  <WeatherStrip forecast={weatherForecast} />
)}
```

- [ ] **Step 3: Replace the inline calendar with MonthCalendar**

Find the section that renders the monthly grid (look for `calendarDays`, `currentMonth`, day cells). Replace the entire calendar `<div>` with:
```tsx
<MonthCalendar
  month={currentMonth}
  entries={monthEntriesForView}
  members={dashboard.members}
  memberColorById={memberColorById}
  selectedDate={selectedDate}
  onSelectDate={setSelectedDate}
  onPrevMonth={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
  onNextMonth={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
/>
```

Note: `selectedDate` state may not exist yet — check if there's an equivalent (`currentDate`?) and adapt. If not, add:
```tsx
const [selectedDate, setSelectedDate] = useState(new Date());
```

- [ ] **Step 4: Update Dagsorden to member columns**

Find the "Dagsorden" / "Day agenda" section in dashboard-app.tsx. Replace the vertical list of events with a member-column layout:
```tsx
{/* Dagsorden — member columns */}
<section className="rounded-xl border border-border bg-card overflow-hidden">
  <div className="px-4 py-2.5 border-b border-border/50">
    <h3 className="text-xs font-bold text-foreground">
      {selectedDate.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' })}
    </h3>
  </div>
  <div className="flex divide-x divide-border/30">
    {dashboard.members.map((member) => {
      const selectedStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}-${String(selectedDate.getDate()).padStart(2,'0')}`;
      const dayEntries = monthEntriesForView.filter((e) => {
        const eDate = new Date(e.startTime).toISOString().slice(0, 10);
        return (e.ownerMemberId === member.id || (e.visibleMemberIds ?? []).includes(member.id)) && eDate === selectedStr;
      });
      const color = memberColorById[member.id] ?? '#6d5efc';
      return (
        <div key={member.id} className="flex-1">
          <div className="flex flex-col items-center gap-1 px-1 py-2 bg-muted/20 border-b border-border/30">
            <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: color }}>
              {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
            </div>
            <span className="text-[8px] font-bold text-muted-foreground">{member.name.split(' ')[0]}</span>
          </div>
          <div className="flex flex-col gap-1 p-1.5 min-h-[40px]">
            {dayEntries.length === 0 ? (
              <span className="text-[9px] text-muted-foreground/40 text-center py-2">—</span>
            ) : dayEntries.map((e) => (
              <span key={e.id} className="block truncate rounded-full px-1.5 py-[2px] text-[9px] font-bold text-white" style={{ background: color }} title={e.title}>
                {e.title}
              </span>
            ))}
          </div>
        </div>
      );
    })}
  </div>
</section>
```

- [ ] **Step 5: Update Upcoming events with colored left bar**

Find the "Upcoming events" / "Kommende begivenheder" list. Update each item to include a 4px coloured left bar and member dots:
```tsx
{upcomingEntriesForSidebar.slice(0, 8).map((entry) => {
  const color = memberColorById[entry.ownerMemberId] ?? '#6d5efc';
  const member = dashboard.members.find((m) => m.id === entry.ownerMemberId);
  const startDate = new Date(entry.startTime);
  return (
    <div key={entry.id} className="flex items-stretch border-b border-border/30 last:border-b-0 cursor-pointer hover:bg-muted/30" onClick={() => handleOpenEntry(entry)}>
      <div className="w-1 shrink-0 rounded-l" style={{ background: color }} />
      <div className="flex items-center gap-2.5 px-3 py-2 flex-1">
        <div className="text-center w-7 shrink-0">
          <div className="text-sm font-black leading-none">{startDate.getDate()}</div>
          <div className="text-[8px] font-bold text-muted-foreground uppercase">
            {startDate.toLocaleDateString('da-DK', { weekday: 'short' })}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="truncate text-[11px] font-bold">{entry.title}</div>
          <div className="flex items-center gap-1 mt-0.5">
            <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-[9px] text-muted-foreground">{member?.name} · {startDate.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
})}
```

- [ ] **Step 6: Remove the AI assistant section from Hjem**

Find and delete the block that renders the AI input (search for `assistantMessage`, `setAssistantMessage` in the dashboard JSX section). The 🤖 button in SlimHeader already handles this.

- [ ] **Step 7: Run typecheck + visual check**

```bash
npm run typecheck
npm run dev:frontend
```

Open http://localhost:5173 — verify Hjem looks correct with new calendar, dagsorden columns, updated upcoming.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat(ui): hjem — MonthCalendar, member-column dagsorden, coloured upcoming"
```

---

## Phase 3 — I dag view

### Task 5: MealDetailSheet component

**Files:**
- Create: `packages/frontend/components/meal-detail-sheet.tsx`

- [ ] **Step 1: Check FoodPlanItem type**

Run: `grep -n "FoodPlanItem\|dishName\|groceryList\|FoodPlanDay" packages/contracts/src/domain.ts`

Expected shape:
```typescript
interface FoodPlanItem {
  id: string;
  weekStart: string;
  day: FoodPlanDay;  // 'monday' | 'tuesday' | ... | 'sunday'
  dishName: string;
  groceryList: string[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create MealDetailSheet**

```tsx
'use client';

import { X } from 'lucide-react';
import type { FoodPlanItem } from '@mental-load/contracts';

const DAY_LABELS: Record<string, string> = {
  monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag',
  thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
};

const FOOD_EMOJI: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', grillret: '🥩',
};

function getFoodEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽';
}

type Props = {
  item: FoodPlanItem | null;
  onClose: () => void;
};

export function MealDetailSheet({ item, onClose }: Props) {
  if (!item) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-card border-t border-border shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl">{getFoodEmoji(item.dishName)}</span>
          <div className="flex-1">
            <div className="font-black text-base">{item.dishName}</div>
            <div className="text-xs text-muted-foreground">{DAY_LABELS[item.day]}</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        {item.groceryList.length > 0 && (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Indkøbsliste
            </div>
            <div className="flex flex-col gap-1">
              {item.groceryList.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm">
                  <span>🛒</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {item.groceryList.length === 0 && (
          <p className="text-sm text-muted-foreground">Ingen indkøbsliste endnu. Rediger måltidsplanen for at tilføje ingredienser.</p>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/meal-detail-sheet.tsx
git commit -m "feat(ui): add MealDetailSheet for food plan tap interaction"
```

---

### Task 6: IDagView component

**Files:**
- Create: `packages/frontend/components/idag-view.tsx`

- [ ] **Step 1: Check TimeGrid and WeekGrid prop types**

Run:
```bash
grep -n "^type Props\|^interface Props\|^export function TimeGrid\|^export function WeekGrid" packages/frontend/components/time-grid.tsx packages/frontend/components/week-grid.tsx
```

Note the exact prop names. Both components accept `members`, `entries` (or similar), and `memberColorById`. Adjust the IDagView below to match their actual prop signatures.

- [ ] **Step 2: Create IDagView**

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Entry, Member, FoodPlanItem } from '@mental-load/contracts';
import { TimeGrid } from '@/components/time-grid';
import { WeekGrid } from '@/components/week-grid';
import { MealDetailSheet } from '@/components/meal-detail-sheet';

const DAY_LABELS_SHORT: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons',
  thursday: 'Tor', friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};

const FOOD_EMOJI: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', grillret: '🥩',
};

function getFoodEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽';
}

// Mon–Fri in order
const WEEKDAYS: FoodPlanItem['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

type Props = {
  members: Member[];
  entries: Entry[];
  memberColorById: Record<string, string>;
  foodPlanItems: FoodPlanItem[];
};

export function IDagView({ members, entries, memberColorById, foodPlanItems }: Props) {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [selectedMeal, setSelectedMeal] = useState<FoodPlanItem | null>(null);

  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as FoodPlanItem['day'];

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* Today / Uge toggle */}
      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => setView('today')}
          className={cn('px-4 py-1.5 text-xs font-bold transition-colors', view === 'today' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/60')}
        >
          I dag
        </button>
        <button
          type="button"
          onClick={() => setView('week')}
          className={cn('px-4 py-1.5 text-xs font-bold transition-colors', view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/60')}
        >
          Uge
        </button>
      </div>

      {/* Member avatar column headers */}
      <div className="flex rounded-xl border border-border bg-card overflow-hidden">
        <div className="w-8 shrink-0" /> {/* time gutter spacer */}
        {members.map((member) => {
          const color = memberColorById[member.id] ?? '#6d5efc';
          return (
            <div key={member.id} className="flex-1 flex flex-col items-center gap-1 py-2.5 border-l border-border/40 first:border-l-0">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-black text-white shadow-md shrink-0"
                style={{ background: color }}
              >
                {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-[9px] font-bold text-muted-foreground">{member.name.split(' ')[0]}</span>
            </div>
          );
        })}
      </div>

      {/* Time grid or week grid */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {view === 'today' ? (
          <TimeGrid
            members={members}
            entries={entries}
            memberColorById={memberColorById}
          />
        ) : (
          <WeekGrid
            members={members}
            entries={entries}
            memberColorById={memberColorById}
          />
        )}
      </div>

      {/* Meal strip */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          🍽 Madplan denne uge
        </div>
        <div className="flex gap-2">
          {WEEKDAYS.map((day) => {
            const item = foodPlanItems.find((f) => f.day === day);
            const isToday = day === todayDay;
            return (
              <button
                key={day}
                type="button"
                onClick={() => item && setSelectedMeal(item)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 rounded-lg border py-2 px-1 transition-all',
                  isToday
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/50',
                  !item && 'opacity-50 cursor-default',
                )}
              >
                <span className={cn('text-[8px] font-bold', isToday ? 'text-primary' : 'text-muted-foreground')}>
                  {DAY_LABELS_SHORT[day]}
                  {isToday ? ' ●' : ''}
                </span>
                <span className="text-lg leading-none">{item ? getFoodEmoji(item.dishName) : '—'}</span>
                <span className="text-[8px] font-bold text-foreground truncate w-full text-center">
                  {item?.dishName.split(' ')[0] ?? ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Meal detail sheet */}
      <MealDetailSheet item={selectedMeal} onClose={() => setSelectedMeal(null)} />
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Fix any prop mismatches with `TimeGrid` / `WeekGrid`. If `TimeGrid` uses different prop names (e.g. `entriesForDay`, `selectedDate`), adapt `IDagView` to match.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/idag-view.tsx
git commit -m "feat(ui): add IDagView with toggle, member avatar headers, interactive meal strip"
```

---

## Phase 4 — Planner view (AI availability finder)

### Task 7: PlannerView component

**Files:**
- Create: `packages/frontend/components/planner-view.tsx`

The Planner uses the existing `askAssistant` (fun endpoint) with calendar context injected into the question.

- [ ] **Step 1: Create PlannerView**

```tsx
'use client';

import { useState } from 'react';
import { Send, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry, Member, FoodPlanItem } from '@mental-load/contracts';
import { askAssistant } from '@/lib/api';
import { MealDetailSheet } from '@/components/meal-detail-sheet';

const QUICK_CHIPS = [
  'Hvornår er alle fri denne uge?',
  'Ledigt mandag?',
  'Find 2 timer til hele familien',
  'Hvornår kan vi spise aftensmad sammen?',
];

const WEEKDAYS: FoodPlanItem['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_LABELS_SHORT: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons',
  thursday: 'Tor', friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};

const FOOD_EMOJI_MAP: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', grillret: '🥩',
};

function getFoodEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJI_MAP)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽';
}

/** Format entries for the next 7 days as a compact text block for the AI prompt */
function buildCalendarContext(entries: Entry[], members: Member[]): string {
  const memberById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const now = new Date();
  const limit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const relevant = entries.filter((e) => {
    const start = new Date(e.startTime);
    return start >= now && start <= limit;
  });
  if (relevant.length === 0) return 'Ingen aftaler de næste 7 dage.';
  return relevant.map((e) => {
    const start = new Date(e.startTime);
    const who = memberById[e.ownerMemberId] ?? 'Ukendt';
    const day = start.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });
    const time = e.allDay ? 'hele dagen' : start.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    return `- ${day} ${time}: ${e.title} (${who})`;
  }).join('\n');
}

type Props = {
  members: Member[];
  entries: Entry[];
  memberColorById: Record<string, string>;
  foodPlanItems: FoodPlanItem[];
  onCreateEntry?: () => void;
};

export function PlannerView({ members, entries, memberColorById, foodPlanItems, onCreateEntry }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<FoodPlanItem | null>(null);

  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() as FoodPlanItem['day'];

  async function handleAsk(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setAskedQuestion(q);
    setAnswer('');
    setQuestion('');
    try {
      const calendarContext = buildCalendarContext(entries, members);
      const memberNames = members.map((m) => m.name).join(', ');
      const prompt = `Familiemedlemmer: ${memberNames}\n\nKalender de næste 7 dage:\n${calendarContext}\n\nSpørgsmål: ${q}\n\nSvar på dansk. Vær konkret og hjælpsom. Find ledige tider og svar direkte.`;
      const result = await askAssistant({ message: prompt });
      setAnswer(result.response);
    } catch {
      setAnswer('Beklager, kunne ikke hente svar. Prøv igen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* AI input bar */}
      <div className="flex items-center gap-2 rounded-xl border-2 border-primary bg-card px-3 py-2 shadow-sm shadow-primary/10">
        <span className="text-lg">🤖</span>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleAsk(question)}
          placeholder="Hvornår kan vi…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => void handleAsk(question)}
          disabled={!question.trim() || busy}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Quick chips */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => void handleAsk(chip)}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* AI answer */}
      {(busy || answer) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
            <span className="text-sm">🤖</span>
            <span className="text-[11px] font-bold text-foreground truncate">{askedQuestion}</span>
          </div>
          <div className="px-3 py-3">
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="animate-spin text-primary">⏳</span>
                <span>Tjekker kalenderen…</span>
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{answer}</p>
                {onCreateEntry && (
                  <button
                    type="button"
                    onClick={onCreateEntry}
                    className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tilføj til kalender
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Meal strip */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          🍽 Madplan denne uge
        </div>
        <div className="flex gap-2">
          {WEEKDAYS.map((day) => {
            const item = foodPlanItems.find((f) => f.day === day);
            const isToday = day === todayDay;
            return (
              <button
                key={day}
                type="button"
                onClick={() => item && setSelectedMeal(item)}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 rounded-lg border py-2 px-1 transition-all',
                  isToday ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/50',
                  !item && 'opacity-50 cursor-default',
                )}
              >
                <span className={cn('text-[8px] font-bold', isToday ? 'text-primary' : 'text-muted-foreground')}>
                  {DAY_LABELS_SHORT[day]}{isToday ? ' ●' : ''}
                </span>
                <span className="text-lg leading-none">{item ? getFoodEmoji(item.dishName) : '—'}</span>
                <span className="text-[8px] font-bold text-foreground truncate w-full text-center">
                  {item?.dishName.split(' ')[0] ?? ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <MealDetailSheet item={selectedMeal} onClose={() => setSelectedMeal(null)} />
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/planner-view.tsx
git commit -m "feat(ui): add PlannerView with AI availability finder and meal strip"
```

---

## Phase 5 — Familie view

### Task 8: FamilieView component

**Files:**
- Create: `packages/frontend/components/familie-view.tsx`

- [ ] **Step 1: Create FamilieView**

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown, Plus, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AulaPresence, Entry, Member, TodayMemberTimeline } from '@mental-load/contracts';

type PresenceStatus = 'present' | 'work' | 'school' | 'offline';

function resolvePresence(presence: AulaPresence | undefined, member: Member): { status: PresenceStatus; label: string } {
  if (!presence) return { status: 'offline', label: member.role === 'child' ? 'Status ukendt' : 'Status ukendt' };
  const s = presence.status;
  if (s === 'tilstede') return { status: 'present', label: '🟢 Tilstede' };
  if (s === 'ikke_ankommet') return { status: 'school', label: '🟣 I skole' };
  if (s === 'hentet') return { status: 'present', label: '🟢 Hentet' };
  if (s === 'syg') return { status: 'offline', label: '🔴 Syg' };
  if (s === 'ferie') return { status: 'offline', label: '⛱ Ferie' };
  return { status: 'offline', label: s };
}

const PRESENCE_DOT: Record<PresenceStatus, string> = {
  present: 'bg-green-500',
  work: 'bg-amber-400',
  school: 'bg-violet-500',
  offline: 'bg-gray-300',
};

type TaskItem = {
  id: string;
  title: string;
  time?: string;
  done: boolean;
  reward?: string;
};

function buildTasksForMember(member: Member, entries: Entry[], timeline: TodayMemberTimeline | undefined): TaskItem[] {
  const tasks: TaskItem[] = [];

  // From timeline (daily routine tasks)
  if (timeline) {
    for (const task of timeline.tasks) {
      if (task.status === 'skipped') continue;
      tasks.push({
        id: task.id,
        title: task.title,
        time: task.dueAt ? new Date(task.dueAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : undefined,
        done: task.status === 'completed',
        reward: task.rewardText ?? undefined,
      });
    }
  }

  // From entry checklists assigned to this member
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of entries) {
    if (new Date(entry.startTime).toISOString().slice(0, 10) !== today) continue;
    if (entry.ownerMemberId !== member.id && !(entry.assignedToMemberId === member.id)) continue;
    for (const item of entry.checklist) {
      if (item.assignedToMemberId && item.assignedToMemberId !== member.id) continue;
      tasks.push({
        id: `${entry.id}-${item.id}`,
        title: item.text,
        done: item.isCompleted,
      });
    }
  }

  return tasks;
}

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  presenceByMemberId: Record<string, AulaPresence>;
  entries: Entry[];
  timelinesByMemberId: Record<string, { timeline: TodayMemberTimeline }>;
  onAddMember: () => void;
  onNavigateToMember: (memberId: string) => void;
};

export function FamilieView({ members, memberColorById, presenceByMemberId, entries, timelinesByMemberId, onAddMember, onNavigateToMember }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 p-3">
      {members.map((member) => {
        const color = memberColorById[member.id] ?? '#6d5efc';
        const presence = presenceByMemberId[member.id];
        const { label: presenceLabel, status: presenceStatus } = resolvePresence(presence, member);
        const isExpanded = expandedId === member.id;
        const timelineData = timelinesByMemberId[member.id];
        const tasks = buildTasksForMember(member, entries, timelineData?.timeline);
        const doneCount = tasks.filter((t) => t.done).length;
        const progress = tasks.length > 0 ? doneCount / tasks.length : 0;

        // Next upcoming event
        const today = new Date().toISOString().slice(0, 10);
        const nextEvent = entries
          .filter((e) => e.ownerMemberId === member.id && new Date(e.startTime).toISOString().slice(0, 10) >= today)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

        return (
          <div key={member.id} className={cn('rounded-xl border bg-card overflow-hidden transition-shadow', isExpanded ? 'border-border shadow-sm' : 'border-border/70')}>
            {/* Card header */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : member.id)}
            >
              {/* Avatar with presence dot */}
              <div className="relative shrink-0">
                <div className="h-11 w-11 rounded-full flex items-center justify-center text-lg font-black text-white shadow-md" style={{ background: color }}>
                  {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
                </div>
                <div className={cn('absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card', PRESENCE_DOT[presenceStatus])} />
              </div>

              {/* Name + role + status */}
              <div className="flex-1 min-w-0">
                <div className="font-black text-sm text-foreground">{member.name}</div>
                <div className="text-[10px] text-muted-foreground">{member.role === 'parent' ? 'Forælder' : 'Barn'}</div>
                <div className="text-[10px] font-semibold mt-0.5">{presenceLabel}</div>
              </div>

              {/* Progress + chevron */}
              <div className="flex flex-col items-end gap-1.5">
                {tasks.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-16 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${progress * 100}%`, background: color }} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground">{doneCount}/{tasks.length}</span>
                  </div>
                )}
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-180')} />
              </div>
            </button>

            {/* Expanded body */}
            {isExpanded && (
              <div className="border-t border-border/50 px-4 pb-4 pt-3" onClick={(e) => e.stopPropagation()}>

                {/* Next event */}
                {nextEvent && (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 mb-3">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                    <div>
                      <div className="text-[9px] text-muted-foreground">Næste aftale</div>
                      <div className="text-[11px] font-bold">
                        {nextEvent.title} ·{' '}
                        {new Date(nextEvent.startTime).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Task list */}
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Opgaver i dag
                </div>

                {tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">Ingen opgaver i dag.</p>
                ) : (
                  <div className="flex flex-col">
                    {tasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-2.5 py-2 border-b border-border/30 last:border-b-0">
                        <div className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-colors', task.done ? 'bg-green-500 border-green-500 text-white' : 'border-muted-foreground/30')}>
                          {task.done && '✓'}
                        </div>
                        <span className={cn('flex-1 text-[11px]', task.done && 'line-through text-muted-foreground')}>
                          {task.title}
                        </span>
                        {task.time && <span className="text-[10px] text-muted-foreground">{task.time}</span>}
                        {task.reward && <span className="text-sm">{task.reward}</span>}
                      </div>
                    ))}

                    {/* Motivational hint */}
                    {tasks.length > 0 && doneCount === tasks.length && (
                      <div className="mt-2 text-center text-[11px] font-bold text-green-600">🎉 Alle opgaver klaret!</div>
                    )}
                    {tasks.length > 0 && doneCount === tasks.length - 1 && (
                      <div className="mt-2 text-center text-[11px] font-semibold text-primary">
                        🎉 Næsten i mål! 1 opgave tilbage
                      </div>
                    )}
                  </div>
                )}

                {/* Link to full member page */}
                <button
                  type="button"
                  onClick={() => onNavigateToMember(member.id)}
                  className="mt-3 w-full rounded-lg border border-border/60 py-1.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  Åbn {member.name}s side →
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add member */}
      <button
        type="button"
        onClick={onAddMember}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/60 py-3 text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
      >
        <UserPlus className="h-4 w-4" />
        Tilføj familiemedlem
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Fix any type errors. Key ones to watch:
- `AulaPresence` import — comes from `@mental-load/contracts`
- `timelinesByMemberId` type — may need `ListTodayMemberTimelineResponse` instead of `{ timeline: TodayMemberTimeline }`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/familie-view.tsx
git commit -m "feat(ui): add FamilieView with expandable member cards and task lists"
```

---

## Phase 6 — Navigation rewire

### Task 9: Update BottomNav and wire all views into dashboard-app

**Files:**
- Modify: `packages/frontend/components/bottom-nav.tsx`
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Update BottomNav**

Replace entire content of `packages/frontend/components/bottom-nav.tsx`:
```tsx
'use client';

import { CalendarDays, Clock, ClipboardList, Users, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavSection = 'dashboard' | 'idag' | 'planner' | 'family' | 'settings';

const NAV_ITEMS: Array<{ key: NavSection; label: string; Icon: React.ElementType }> = [
  { key: 'dashboard', label: 'Hjem',       Icon: CalendarDays },
  { key: 'idag',      label: 'I dag',      Icon: Clock },
  { key: 'planner',   label: 'Planner',    Icon: ClipboardList },
  { key: 'family',    label: 'Familie',    Icon: Users },
  { key: 'settings',  label: 'Indstil.',   Icon: Settings },
];

type Props = {
  active: NavSection;
  onSelect: (section: NavSection) => void;
};

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary navigation"
      className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-border bg-card"
    >
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-label={label}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors',
            active === key
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <div className={cn('rounded-lg p-1 transition-colors', active === key && 'bg-primary/10')}>
            <Icon className="h-5 w-5" />
          </div>
          {label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Fix NavSection references in dashboard-app.tsx**

The old values `'planner'` and `'timeline'` are now renamed. Update these in `dashboard-app.tsx`:

```typescript
// Line 228 — navSectionFromQuery
// Before:
if (value === 'dashboard' || value === 'planner' || value === 'timeline' || value === 'family' || value === 'settings')
// After:
if (value === 'dashboard' || value === 'idag' || value === 'planner' || value === 'family' || value === 'settings')

// Line 248 — timeline data load effect
// Before: if (activeNav !== 'timeline' ...)
// After:  if (activeNav !== 'family' ...)   ← timeline data now loaded for Familie view

// Line 735 — handleNavClick
// Before: if (section === 'dashboard' || section === 'timeline' || ...)
// After:  if (section === 'dashboard' || section === 'idag' || section === 'planner' || section === 'family' || section === 'settings')

// Remove the special case for section === 'planner' that launched KioskPlanner
```

- [ ] **Step 3: Add food plan state + loading to dashboard-app.tsx**

Add after existing state declarations (around line 200):
```tsx
const [foodPlanItems, setFoodPlanItems] = useState<import('@mental-load/contracts').FoodPlanItem[]>([]);
```

In the main data load `useEffect` (where `loadDashboardSnapshot` is called), add:
```tsx
const foodPlan = await loadFoodPlan();
setFoodPlanItems(foodPlan.items);
```

Add the import at the top:
```tsx
import { loadFoodPlan } from '@/lib/api';
import type { FoodPlanItem } from '@mental-load/contracts';
```

- [ ] **Step 4: Import and wire new view components in dashboard-app.tsx**

Add imports:
```tsx
import { IDagView } from '@/components/idag-view';
import { PlannerView } from '@/components/planner-view';
import { FamilieView } from '@/components/familie-view';
```

- [ ] **Step 5: Replace KioskPlanner block with IDagView**

Find (around line 1631):
```tsx
{activeNav === 'planner' ? (
  <KioskPlanner ... />
) : isMobile && !mobileDesktopOverride ? (
```

Replace the entire KioskPlanner branch:
```tsx
{/* No more full-screen kiosk. KioskPlanner is no longer a nav destination. */}
{isMobile && !mobileDesktopOverride ? (
```

Then inside the desktop layout, find where view sections are conditionally rendered. Add new view sections:

```tsx
{/* I dag */}
{activeNav === 'idag' && (
  <IDagView
    members={dashboard.members}
    entries={monthEntriesForView}
    memberColorById={memberColorById}
    foodPlanItems={foodPlanItems}
  />
)}

{/* Planner */}
{activeNav === 'planner' && (
  <PlannerView
    members={dashboard.members}
    entries={upcomingEntriesForView}
    memberColorById={memberColorById}
    foodPlanItems={foodPlanItems}
    onCreateEntry={() => openCreateEntryComposer()}
  />
)}

{/* Familie */}
{activeNav === 'family' && (
  <FamilieView
    members={dashboard.members}
    memberColorById={memberColorById}
    presenceByMemberId={dashboard.presence}
    entries={monthEntriesForView}
    timelinesByMemberId={todayTimelinesByMemberId}
    onAddMember={() => setShowNewMemberModal(true)}
    onNavigateToMember={(id) => router.push(`/member/${id}`)}
  />
)}
```

- [ ] **Step 6: Remove old timeline section**

Find and delete (or comment out) the `{activeNav === 'timeline' ? (` block. The `TodayTimelineBoard` is now rendered inside `FamilieView`.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Fix any remaining type errors. Common issues:
- `openCreateEntryComposer` — check exact function name in dashboard-app
- `setShowNewMemberModal` — check the actual state setter name
- `upcomingEntriesForView` vs `upcomingOccurrences` — use whichever is in scope

- [ ] **Step 8: Run the app and verify navigation**

```bash
npm run dev:frontend
```

Click all 5 nav tabs. Check that:
- Hjem: shows calendar, weather, dagsorden, upcoming
- I dag: shows time grid with member avatars + meal strip
- Planner: shows AI input bar, chips
- Familie: shows member cards, tap to expand
- Indstillinger: shows settings tabs

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/components/bottom-nav.tsx packages/frontend/components/dashboard-app.tsx
git commit -m "feat(ui): rewire navigation — I dag/Planner/Familie views, remove KioskPlanner default"
```

---

## Phase 7 — Cleanup

### Task 10: Fix kiosk hardcoded colors

**Files:**
- Modify: `packages/frontend/components/kiosk-planner.tsx`
- Modify: `packages/frontend/components/kiosk-top-bar.tsx`
- Modify: `packages/frontend/components/time-grid.tsx`
- Modify: `packages/frontend/components/week-grid.tsx`
- Modify: `packages/frontend/components/today-timeline-board.tsx`

- [ ] **Step 1: Find all hardcoded dark values**

```bash
grep -n "bg-\[#0f0f1a\]\|bg-\[#1a1a2e\]\|border-white/\|text-white\|bg-white/\|bg-black/" \
  packages/frontend/components/kiosk-planner.tsx \
  packages/frontend/components/kiosk-top-bar.tsx \
  packages/frontend/components/time-grid.tsx \
  packages/frontend/components/week-grid.tsx
```

- [ ] **Step 2: Replace hardcoded colors with tokens**

For each occurrence found in step 1, apply these replacements:

| Hardcoded | Replace with |
|---|---|
| `bg-[#0f0f1a]` | `bg-background` |
| `bg-[#1a1a2e]` | `bg-card` |
| `border-white/10` | `border-border` |
| `border-white/20` | `border-border` |
| `bg-white/5` | `bg-muted/30` |
| `bg-white/6` | `bg-muted/30` |
| `bg-white/10` | `bg-muted/50` |
| `text-white` (standalone heading) | `text-foreground` |
| `bg-black/40` | `bg-card/80` |

Run `grep` again after to confirm no hardcoded values remain.

- [ ] **Step 3: Fix confetti colors in today-timeline-board.tsx**

Find the confetti color array (search for `'#f43f5e'` or `confetti`):

```bash
grep -n "f43f5e\|confetti\|colors.*#" packages/frontend/components/today-timeline-board.tsx
```

Replace hardcoded hex array with chart tokens. The confetti library likely takes an array of color strings. Replace the hardcoded colors:
```typescript
// Before (example):
colors: ['#f43f5e', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6']

// After:
colors: [
  getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim() || '#f43f5e',
  getComputedStyle(document.documentElement).getPropertyValue('--chart-2').trim() || '#3b82f6',
  getComputedStyle(document.documentElement).getPropertyValue('--chart-3').trim() || '#22c55e',
  getComputedStyle(document.documentElement).getPropertyValue('--chart-4').trim() || '#f59e0b',
  getComputedStyle(document.documentElement).getPropertyValue('--chart-5').trim() || '#8b5cf6',
]
```

Note: if the confetti library is called server-side or in a context where `document` is unavailable, wrap in a check: `typeof document !== 'undefined' ? getComputedStyle(...) : '#f43f5e'`.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/components/kiosk-planner.tsx \
        packages/frontend/components/kiosk-top-bar.tsx \
        packages/frontend/components/time-grid.tsx \
        packages/frontend/components/week-grid.tsx \
        packages/frontend/components/today-timeline-board.tsx
git commit -m "fix(ui): replace hardcoded kiosk dark colors with CSS tokens"
```

---

### Task 11: Delete AppSidebar dead code

**Files:**
- Delete: `packages/frontend/components/app-sidebar.tsx`
- Modify: `packages/frontend/components/dashboard-app.tsx` (remove import if present)

- [ ] **Step 1: Confirm AppSidebar is not imported anywhere**

```bash
grep -rn "app-sidebar\|AppSidebar" packages/frontend/
```

If the result shows only `app-sidebar.tsx` itself (no imports), proceed. If it's imported somewhere, remove that import and any JSX usage first.

- [ ] **Step 2: Delete the file**

```bash
rm packages/frontend/components/app-sidebar.tsx
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(ui): delete dead AppSidebar component"
```

---

### Task 12: Full QA pass

- [ ] **Step 1: Run integration tests**

```bash
npm run test:integration
```

Expected: all tests pass (backend only, no frontend tests).

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 4: Manual visual check — all 5 views**

Start dev server: `npm run dev:frontend`

Check each view at http://localhost:5173:
- **Hjem**: light bg, weather with day borders, calendar with coloured pills, dagsorden member columns, upcoming with coloured bars, no AI section
- **I dag**: toggle works, member avatars over columns, time grid renders, meal strip tappable
- **Planner**: AI bar, chips, answer card on submit
- **Familie**: member cards expand/collapse, task lists show, progress bars
- **Indstillinger**: tabs work, same visual language

- [ ] **Step 5: Final commit + push**

```bash
git add -A
git commit -m "chore(ui): final lint + typecheck fixes"
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] §2 Design tokens — Task 1 (globals.css update)
- [x] §3 Shared shell — shell already exists; nav rewired in Task 9
- [x] §4.1 Hjem — Tasks 2, 3, 4 (WeatherStrip, MonthCalendar, dagsorden/upcoming updates)
- [x] §4.2 I dag — Tasks 5, 6 (MealDetailSheet, IDagView)
- [x] §4.3 Planner — Task 7 (PlannerView)
- [x] §4.4 Familie — Task 8 (FamilieView)
- [x] §4.5 Indstillinger — visual polish inherited from token changes; no dedicated task needed
- [x] §5 UI consistency fixes — Task 10 (kiosk colors, confetti), Task 11 (AppSidebar)
- [x] §6 Theme switch — Task 1 (layout.tsx + globals.css)

**No gaps found.**
