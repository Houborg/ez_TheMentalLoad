# Kiosk Planner & Global Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop sidebar + top header with a slim global header and bottom nav bar, and redesign the Planner view into a full-screen kiosk with a live today time-grid, week overview, and food plan strip.

**Architecture:** The shell in `dashboard-app.tsx` gains an early return: when `activeNav === 'planner'`, it renders `<KioskPlanner>` at full-viewport with no header or nav. All other views use a new `<SlimHeader>` (live clock + weather + Add + AI) and `<BottomNav>` (5 items pinned to the bottom). The kiosk is self-contained and loads its own data.

**Tech Stack:** React 19, Next.js 16 (App Router), Tailwind v4, TypeScript, existing API helpers from `packages/frontend/lib/api.ts`, types from `@mental-load/contracts`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/frontend/components/slim-header.tsx` | **Create** | Live clock + date + weather pill + AI + Add buttons — rendered on all non-kiosk views |
| `packages/frontend/components/bottom-nav.tsx` | **Create** | 5-item bottom nav bar replacing the sidebar — rendered on all non-kiosk views |
| `packages/frontend/components/kiosk-top-bar.tsx` | **Create** | Kiosk-mode header: large clock, weather, today/week toggle, Add, AI, ☰ exit |
| `packages/frontend/components/time-grid.tsx` | **Create** | Today time-grid: member columns, hour lines, event blocks, auto-scrolling now-line |
| `packages/frontend/components/week-grid.tsx` | **Create** | Week view: day rows × member columns, event chips, per-day weather icon |
| `packages/frontend/components/kiosk-planner.tsx` | **Create** | Full-screen kiosk orchestrator — data loading, layout, bottom split (meal + tasks), food strip |
| `packages/frontend/components/dashboard-app.tsx` | **Modify** | Remove `<aside>` + old `<header>`; add SlimHeader + BottomNav; add kiosk early-return |
| `packages/frontend/components/planner-view.tsx` | **Delete** | Replaced entirely by `kiosk-planner.tsx` |

---

## Constants used across components

The time-grid and kiosk planner share these values. Define them once at the top of the files that use them — do **not** create a shared constants file (YAGNI).

```ts
const START_HOUR = 6;   // grid starts at 06:00
const END_HOUR = 23;    // grid ends at 23:00
const HOUR_HEIGHT = 64; // px per hour

const DAY_NAMES: Record<number, string> = {
  0: 'Søn', 1: 'Man', 2: 'Tir', 3: 'Ons', 4: 'Tor', 5: 'Fre', 6: 'Lør',
};

const FOOD_PLAN_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

const FOOD_DAY_LABELS: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons', thursday: 'Tor',
  friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};
```

---

## Task 1: SlimHeader component

**Files:**
- Create: `packages/frontend/components/slim-header.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { WeatherForecastResponse } from '@/lib/api';

type Props = {
  weatherForecast: WeatherForecastResponse | null;
  onAdd: () => void;
  onAI: () => void;
};

export function SlimHeader({ weatherForecast, onAdd, onAI }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-card/40 px-4 backdrop-blur md:px-6">
      <span className="text-base font-bold tabular-nums tracking-tight">{timeStr}</span>
      <span className="text-xs text-muted-foreground">{dateStr}</span>
      {weatherForecast && (
        <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs text-muted-foreground">
          <span>{weatherForecast.current.icon}</span>
          <span>{Math.round(weatherForecast.current.temperature)}°{weatherForecast.unit}</span>
        </div>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onAI}
        className="flex h-9 items-center gap-1.5 rounded-2xl border border-border/60 bg-background/60 px-3 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">AI</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="flex h-9 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Tilføj</span>
      </button>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors in `slim-header.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/slim-header.tsx
git commit -m "feat(layout): add SlimHeader with live clock, weather, Add and AI buttons"
```

---

## Task 2: BottomNav component

**Files:**
- Create: `packages/frontend/components/bottom-nav.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import { CalendarDays, CheckCircle2, Clock3, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

const NAV_ITEMS: Array<{ key: NavSection; label: string; Icon: React.ElementType }> = [
  { key: 'dashboard', label: 'Hjem', Icon: CalendarDays },
  { key: 'planner', label: 'Planner', Icon: Clock3 },
  { key: 'timeline', label: 'I dag', Icon: CheckCircle2 },
  { key: 'family', label: 'Familie', Icon: Users },
  { key: 'settings', label: 'Indstil.', Icon: Settings },
];

type Props = {
  active: NavSection;
  onSelect: (section: NavSection) => void;
};

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary navigation"
      className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-border/50 bg-card/80 backdrop-blur"
    >
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-label={label}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
            active === key
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors in `bottom-nav.tsx`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/bottom-nav.tsx
git commit -m "feat(layout): add BottomNav component with 5 primary nav items"
```

---

## Task 3: Restructure dashboard-app.tsx shell

Replace the `<aside>` sidebar and old `<header>` with `SlimHeader` + `BottomNav`. The Planner kiosk full-screen takeover is wired in Task 8.

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Add imports at the top of `dashboard-app.tsx`**

Find the existing import block and add:

```tsx
import { SlimHeader } from '@/components/slim-header';
import { BottomNav, type NavSection } from '@/components/bottom-nav';
```

Remove the import of `NavSection` if it was previously defined inline in this file (it's now exported from `bottom-nav.tsx`). Also remove these icon imports that were only used by the sidebar/header and are no longer needed: `ChevronLeft`, `ChevronRight`, `Bell`, `RefreshCcw`, `Search`.

- [ ] **Step 2: Remove sidebar state**

Find and delete this line (near the top of the component):

```tsx
const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
```

- [ ] **Step 3: Replace the `<aside>` block**

Find the entire `<aside>` element (from `<aside` to `</aside>`) — it starts around line 1673 and ends around line 1766. Delete it entirely.

- [ ] **Step 4: Replace the `<header>` block with SlimHeader**

Find the old `<header className="sticky top-0 z-20 ...">` element (around line 1769) and replace the entire element with:

```tsx
<SlimHeader
  weatherForecast={weatherForecast}
  onAdd={() => openCreateEntryComposer()}
  onAI={() => setAssistantPanelOpen(true)}
/>
```

> **Note:** Find the actual name of the assistant-panel toggle state in the file by searching for `assistant` near the state declarations (around line 160–200). Common names are `assistantOpen`, `assistantPanelOpen`, or `aiPanelOpen`. Use whatever name is already there.

- [ ] **Step 5: Add weather state at dashboard level**

The old header didn't show weather; the Planner loaded it internally. Now SlimHeader needs it. Add state near the other state declarations:

```tsx
const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
```

And add the import at the top:

```tsx
import type { WeatherForecastResponse } from '@/lib/api';
```

Then inside the existing `useEffect` that calls `loadDashboardSnapshot` (or the health-poll effect), add a weather fetch after settings are loaded. Find where `loadSettings()` is already called and add after it:

```tsx
const settings = await loadSettings();
const w = (settings.sync.configJson.weather ?? {}) as Record<string, unknown>;
if (typeof w.location === 'string' && w.location) {
  try {
    const forecast = await loadWeatherForecast({
      location: w.location,
      state: typeof w.state === 'string' ? w.state : undefined,
      country: typeof w.country === 'string' ? w.country : undefined,
      unit: w.unit === 'F' ? 'F' : 'C',
      days: 7,
    });
    if (active) setWeatherForecast(forecast);
  } catch {
    // weather is non-critical — silently ignore
  }
}
```

Also add `loadWeatherForecast`, `loadSettings` to the imports from `@/lib/api` if not already there.

- [ ] **Step 6: Replace the outer flex-layout and add BottomNav**

Find the line `<div className="flex min-h-screen">` (around line 1672). The new outer structure should be:

```tsx
<div className="flex min-h-screen flex-col">
```

(Change `flex` to `flex flex-col` — the children stack vertically: SlimHeader, main content, BottomNav.)

Then find the closing `</main>` tag at the end of the main content section and add `<BottomNav>` immediately after it:

```tsx
</main>
<BottomNav active={activeNav} onSelect={(s) => handleNavClick(s)} />
```

- [ ] **Step 7: Temporarily keep PlannerView in-place** (it will be replaced in Task 8)

The `activeNav === 'planner'` branch still renders `<PlannerView>` for now — leave it, just make sure it doesn't error.

- [ ] **Step 8: Type-check and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors. Fix any unused-variable lint errors from the removed imports.

- [ ] **Step 9: Smoke test in browser**

```bash
npm run dev
```

Open http://localhost:5173. Verify:
- Slim header at top with clock, date, Add and AI buttons (weather shows if configured)
- Bottom nav shows 5 tabs with active highlight
- Sidebar is gone
- Clicking each tab switches views

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat(layout): replace sidebar+header with SlimHeader and BottomNav"
```

---

## Task 4: KioskTopBar component

**Files:**
- Create: `packages/frontend/components/kiosk-top-bar.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Menu, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WeatherForecastResponse } from '@/lib/api';

export type KioskView = 'today' | 'week';

type Props = {
  view: KioskView;
  onViewChange: (v: KioskView) => void;
  weatherForecast: WeatherForecastResponse | null;
  onAdd: () => void;
  onAI: () => void;
  onExit: () => void;
};

export function KioskTopBar({ view, onViewChange, weatherForecast, onAdd, onAI, onExit }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur">
      <span className="text-2xl font-black tabular-nums tracking-tight text-white/90">{timeStr}</span>
      <span className="text-sm text-white/40">{dateStr}</span>
      {weatherForecast && (
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
          <span>{weatherForecast.current.icon}</span>
          <span>{Math.round(weatherForecast.current.temperature)}°{weatherForecast.unit}</span>
          {weatherForecast.resolvedLocation?.name && (
            <span className="text-white/30">· {weatherForecast.resolvedLocation.name}</span>
          )}
        </div>
      )}
      <div className="flex-1" />
      {/* Today / Uge toggle */}
      <div className="flex rounded-full bg-white/8 p-0.5">
        {(['today', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              view === v ? 'bg-primary text-primary-foreground shadow' : 'text-white/50 hover:text-white/80',
            )}
          >
            {v === 'today' ? 'I dag' : 'Uge'}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAI}
        className="flex h-9 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/6 px-3 text-sm text-white/60 transition hover:text-white/90"
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="flex h-9 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" />
        Tilføj
      </button>
      <button
        type="button"
        onClick={onExit}
        aria-label="Tilbage til menu"
        title="Tilbage til menu"
        className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/40 transition hover:text-white/80"
      >
        <Menu className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/kiosk-top-bar.tsx
git commit -m "feat(kiosk): add KioskTopBar with clock, weather, today/week toggle and controls"
```

---

## Task 5: TimeGrid component (today view)

**Files:**
- Create: `packages/frontend/components/time-grid.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Entry, Member } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 64; // px per hour
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function timeToY(iso: string): number {
  const d = new Date(iso);
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) * HOUR_HEIGHT;
}

function durationPx(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(20, (ms / 3_600_000) * HOUR_HEIGHT);
}

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  entries: Entry[]; // today's events only
};

export function TimeGrid({ members, memberColorById, entries }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowY, setNowY] = useState(0);

  function calcNowY() {
    const d = new Date();
    return (d.getHours() - START_HOUR + d.getMinutes() / 60) * HOUR_HEIGHT;
  }

  // Auto-scroll to now on mount
  useEffect(() => {
    const y = calcNowY();
    setNowY(y);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, y - scrollRef.current.clientHeight / 2);
    }
  }, []);

  // Update now-line every minute
  useEffect(() => {
    const id = setInterval(() => setNowY(calcNowY()), 60_000);
    return () => clearInterval(id);
  }, []);

  const TIME_COL_WIDTH = 36;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="flex" style={{ minHeight: TOTAL_HEIGHT }}>
        {/* Time axis */}
        <div style={{ width: TIME_COL_WIDTH, flexShrink: 0 }}>
          {HOURS.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_HEIGHT }}
              className="flex items-start justify-end pr-2 pt-0.5 text-[10px] text-white/20"
            >
              {h}
            </div>
          ))}
        </div>

        {/* Member columns */}
        <div className="relative flex flex-1 gap-1 pr-2">
          {/* Hour grid lines */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute inset-x-0 border-t border-white/5"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}
            />
          ))}

          {/* Now line */}
          {nowY >= 0 && nowY <= TOTAL_HEIGHT && (
            <div
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: nowY }}
            >
              <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" style={{ marginLeft: -4 }} />
              <div className="h-px flex-1 bg-red-500/60" />
            </div>
          )}

          {members.map((member) => {
            const color = memberColorById[member.id] ?? '#6366f1';
            const memberEntries = entries.filter((e) => entryBelongsToMember(e, member.id));
            return (
              <div key={member.id} className="relative flex-1 border-l border-white/4">
                {memberEntries.map((entry) => {
                  const top = timeToY(entry.startTime);
                  const height = durationPx(entry.startTime, entry.endTime);
                  if (top + height < 0 || top > TOTAL_HEIGHT) return null;
                  return (
                    <div
                      key={entry.id}
                      title={entry.title}
                      className="absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white/90"
                      style={{ top, height, background: color + 'cc' }}
                    >
                      <div className="truncate leading-tight">
                        {new Date(entry.startTime).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="truncate leading-tight">{entry.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/time-grid.tsx
git commit -m "feat(kiosk): add TimeGrid with member columns, event blocks and auto-scrolling now-line"
```

---

## Task 6: WeekGrid component

**Files:**
- Create: `packages/frontend/components/week-grid.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import type { Entry, Member } from '@mental-load/contracts';
import type { WeatherDailyPoint } from '@/lib/api';
import { cn } from '@/lib/utils';

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function isoToDateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

/** Returns the Monday of the current week as a Date */
function getWeekDays(): Date[] {
  const today = new Date();
  const monday = new Date(today);
  const day = today.getDay();
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const WEEK_DAY_LABELS = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  entries: Entry[]; // this week's events
  weatherByDate: Record<string, WeatherDailyPoint>;
};

export function WeekGrid({ members, memberColorById, entries, weatherByDate }: Props) {
  const weekDays = getWeekDays();
  const todayKey = isoToDateKey(new Date().toISOString());

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {weekDays.map((day, i) => {
        const dateKey = isoToDateKey(day.toISOString());
        const isToday = dateKey === todayKey;
        const weather = weatherByDate[dateKey];
        const dayEntries = entries.filter((e) => isoToDateKey(e.startTime) === dateKey);

        return (
          <div
            key={dateKey}
            className={cn(
              'flex min-h-[52px] items-stretch border-b border-white/5 last:border-none',
              isToday && 'bg-primary/5',
            )}
          >
            {/* Day label column */}
            <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-white/5 py-2">
              <span className={cn('text-[9px] font-bold uppercase tracking-wider', isToday ? 'text-primary/60' : 'text-white/20')}>
                {WEEK_DAY_LABELS[i]}
              </span>
              <span className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-sm font-black leading-none',
                isToday ? 'bg-primary text-primary-foreground' : 'text-white/30',
              )}>
                {day.getDate()}
              </span>
              {weather && (
                <span className="text-sm leading-none" title={`${weather.tempMax}°`}>
                  {weather.icon}
                </span>
              )}
            </div>

            {/* Member cells */}
            <div className="grid flex-1 gap-1 p-1.5" style={{ gridTemplateColumns: `repeat(${members.length}, 1fr)` }}>
              {members.map((member) => {
                const color = memberColorById[member.id] ?? '#6366f1';
                const memberDayEntries = dayEntries
                  .filter((e) => entryBelongsToMember(e, member.id))
                  .sort((a, b) => a.startTime.localeCompare(b.startTime));
                return (
                  <div key={member.id} className="flex flex-col gap-0.5 border-l border-white/4 pl-1">
                    {memberDayEntries.map((entry) => (
                      <div
                        key={entry.id}
                        title={entry.title}
                        className="flex items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white/85"
                        style={{ background: color + 'cc' }}
                      >
                        <span className="shrink-0 opacity-70">
                          {new Date(entry.startTime).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="truncate">{entry.title}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/week-grid.tsx
git commit -m "feat(kiosk): add WeekGrid with day rows, member columns and weather icons"
```

---

## Task 7: KioskPlanner component

**Files:**
- Create: `packages/frontend/components/kiosk-planner.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Entry, FoodPlanItem, Member, TimelineTaskInstance, TodayMemberTimeline } from '@mental-load/contracts';
import {
  getWeekStart,
  loadFoodPlan,
  loadMonthOccurrences,
  loadSettings,
  loadTodayTimeline,
  loadWeatherForecast,
  type WeatherDailyPoint,
  type WeatherForecastResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { KioskTopBar, type KioskView } from '@/components/kiosk-top-bar';
import { TimeGrid } from '@/components/time-grid';
import { WeekGrid } from '@/components/week-grid';

// ── helpers ───────────────────────────────────────────────────────────────────

const FOOD_PLAN_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

const FOOD_DAY_LABELS: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons', thursday: 'Tor',
  friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayFoodPlanKey(): string {
  const d = new Date();
  // getDay: 0=Sun … 6=Sat  →  FOOD_PLAN_DAYS index: 0=Mon … 6=Sun
  return FOOD_PLAN_DAYS[(d.getDay() + 6) % 7];
}

function isoToDateKey(iso: string): string {
  return iso.slice(0, 10);
}

// ── types ─────────────────────────────────────────────────────────────────────

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  onAdd: () => void;
  onAI: () => void;
  onExit: () => void;
};

// ── component ─────────────────────────────────────────────────────────────────

export function KioskPlanner({ members, memberColorById, onAdd, onAI, onExit }: Props) {
  const [kioskView, setKioskView] = useState<KioskView>('today');
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [foodPlan, setFoodPlan] = useState<FoodPlanItem[]>([]);
  const [timelineByMember, setTimelineByMember] = useState<Record<string, TodayMemberTimeline>>({});
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const now = new Date();
        const [entries, weekFood, settings] = await Promise.all([
          loadMonthOccurrences(now),
          loadFoodPlan(getWeekStart(now)),
          loadSettings(),
        ]);

        // Load weather
        const w = (settings.sync.configJson.weather ?? {}) as Record<string, unknown>;
        if (typeof w.location === 'string' && w.location) {
          try {
            const forecast = await loadWeatherForecast({
              location: w.location,
              state: typeof w.state === 'string' ? w.state : undefined,
              country: typeof w.country === 'string' ? w.country : undefined,
              unit: w.unit === 'F' ? 'F' : 'C',
              days: 7,
            });
            if (active) setWeatherForecast(forecast);
          } catch { /* non-critical */ }
        }

        // Load today's timeline per member
        const timelines = await Promise.all(
          members.map((m) => loadTodayTimeline(m.id).then((r) => ({ id: m.id, tl: r.timeline }))),
        );

        if (!active) return;
        setAllEntries(entries);
        setFoodPlan(weekFood.items);
        setTimelineByMember(
          Object.fromEntries(timelines.map(({ id, tl }) => [id, tl])),
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [members]);

  // Entries for today only
  const todayEntries = useMemo(
    () => allEntries.filter((e) => isoToDateKey(e.startTime) === todayDateKey()),
    [allEntries],
  );

  // Weather by date map for WeekGrid
  const weatherByDate = useMemo<Record<string, WeatherDailyPoint>>(() => {
    if (!weatherForecast) return {};
    return Object.fromEntries(weatherForecast.daily.map((d) => [d.date, d]));
  }, [weatherForecast]);

  // Today's food plan item
  const todayMeal = foodPlan.find((fp) => fp.day.toLowerCase() === todayFoodPlanKey());

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1a]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#0f0f1a] text-white">
      <KioskTopBar
        view={kioskView}
        onViewChange={setKioskView}
        weatherForecast={weatherForecast}
        onAdd={onAdd}
        onAI={onAI}
        onExit={onExit}
      />

      {/* Member avatar row — centered over columns */}
      <div className="flex shrink-0 items-center border-b border-white/7 py-2.5">
        {/* Offset matching time-axis width (only shown on today view) */}
        {kioskView === 'today' && <div className="w-9 shrink-0" />}
        {/* Member axis offset for week view */}
        {kioskView === 'week' && <div className="w-14 shrink-0" />}
        <div
          className="grid flex-1 gap-1 pr-2"
          style={{ gridTemplateColumns: `repeat(${members.length}, 1fr)` }}
        >
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-center gap-1.5">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: memberColorById[member.id] ?? '#6366f1' }}
              >
                {member.avatar ?? member.name[0].toUpperCase()}
              </div>
              <span className="hidden text-[11px] text-white/50 sm:block">{member.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main view area */}
      {kioskView === 'today' ? (
        <>
          <TimeGrid
            members={members}
            memberColorById={memberColorById}
            entries={todayEntries}
          />

          {/* Bottom split: meal + tasks */}
          <div className="grid shrink-0 grid-cols-2 border-t border-white/7">
            {/* Today's meal */}
            <div className="border-r border-white/7 px-4 py-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                🍽 Aftensmad i dag
              </div>
              {todayMeal ? (
                <>
                  <div className="text-sm font-bold text-white/85">{todayMeal.dishName}</div>
                  {todayMeal.groceryList.length > 0 && (
                    <div className="mt-1 text-xs text-white/35">
                      {todayMeal.groceryList.join(' · ')}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-white/20">Intet planlagt</div>
              )}
            </div>

            {/* Today's tasks */}
            <div className="px-4 py-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                ✅ Opgaver i dag
              </div>
              <div className="space-y-2">
                {members.map((member) => {
                  const timeline = timelineByMember[member.id];
                  const tasks: TimelineTaskInstance[] = timeline?.tasks ?? [];
                  if (tasks.length === 0) return null;
                  return (
                    <div key={member.id} className="flex items-start gap-2">
                      <div
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: memberColorById[member.id] ?? '#6366f1' }}
                      >
                        {member.name[0].toUpperCase()}
                      </div>
                      <div className="space-y-0.5">
                        {tasks.map((task) => (
                          <div
                            key={task.id}
                            className={cn(
                              'flex items-center gap-1 text-xs',
                              task.status === 'completed' ? 'text-white/25 line-through' : 'text-white/65',
                            )}
                          >
                            <span className="text-[10px]">
                              {task.status === 'completed' ? '✓' : '○'}
                            </span>
                            {task.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <WeekGrid
          members={members}
          memberColorById={memberColorById}
          entries={allEntries}
          weatherByDate={weatherByDate}
        />
      )}

      {/* Food plan strip — always visible at bottom */}
      <div className="shrink-0 border-t border-white/7 px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
          Madplan · Denne uge
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {FOOD_PLAN_DAYS.map((day) => {
            const item = foodPlan.find((fp) => fp.day.toLowerCase() === day);
            const isToday = day === todayFoodPlanKey();
            return (
              <div
                key={day}
                className={cn(
                  'rounded-lg px-1.5 py-2 text-center',
                  isToday
                    ? 'border border-primary/30 bg-primary/15'
                    : item
                      ? 'bg-white/5'
                      : 'border border-dashed border-white/8 bg-white/2',
                )}
              >
                <div className={cn('mb-1 text-[9px] font-bold', isToday ? 'text-primary/70' : 'text-white/25')}>
                  {FOOD_DAY_LABELS[day]}
                </div>
                <div className={cn('text-[10px] font-semibold leading-tight', isToday ? 'text-primary/90' : item ? 'text-white/60' : 'text-white/15')}>
                  {item?.dishName ?? '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/kiosk-planner.tsx
git commit -m "feat(kiosk): add KioskPlanner orchestrator with today/week views, meal and task panels"
```

---

## Task 8: Wire KioskPlanner into dashboard-app + remove PlannerView

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`
- Delete: `packages/frontend/components/planner-view.tsx`

- [ ] **Step 1: Add KioskPlanner import**

In `dashboard-app.tsx`, replace:

```tsx
import { PlannerView } from '@/components/planner-view';
```

with:

```tsx
import { KioskPlanner } from '@/components/kiosk-planner';
```

- [ ] **Step 2: Add full-screen kiosk early return**

Find the start of the `return (` in the component (the main JSX return). Add this block immediately before it — so when `activeNav === 'planner'` we bail out early and render only the kiosk:

```tsx
if (activeNav === 'planner') {
  return (
    <>
      <KioskPlanner
        members={dashboard.members}
        memberColorById={memberColorById}
        onAdd={() => openCreateEntryComposer()}
        onAI={() => {
          // find the assistant open setter — e.g. setAssistantOpen(true) or setAiOpen(true)
          // search for how the AI panel is opened in the existing code and use the same call
        }}
        onExit={() => setActiveNav('dashboard')}
      />
      {/* Keep entry composer modal accessible from kiosk */}
      {entryComposerElement}
    </>
  );
}
```

> **Note for the `onAI` callback:** Search `dashboard-app.tsx` for the existing AI/assistant button handler (the `onClick` on the old AI button in the header). Copy that exact handler call here. It's typically something like `setAssistantOpen(true)`.
>
> **Note for `entryComposerElement`:** The entry composer is rendered as JSX inside the main return. You need to pull the composer modal JSX into a variable before the early return, or ensure modals declared later in the render tree still mount. The simplest approach: look for where `createEntryComposerOpen` is used to render the modal and move that JSX block above the early-return. Alternatively, keep the modals in the kiosk's outer `<>` fragment — they'll still render when `activeNav === 'planner'`.

- [ ] **Step 3: Remove old PlannerView branch**

Find:

```tsx
{activeNav === 'planner' ? (
  <PlannerView members={dashboard.members} memberColorById={memberColorById} />
) : ...}
```

Remove the `activeNav === 'planner' ? (<PlannerView .../>) :` ternary. The section now only renders non-planner views.

- [ ] **Step 4: Delete planner-view.tsx**

```bash
git rm packages/frontend/components/planner-view.tsx
```

- [ ] **Step 5: Type-check and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors. If `planner-view.tsx` had any unique utility functions you now need (e.g. `getEntryMutationId`), move them to the calling component or `lib/entry-utils.ts`.

- [ ] **Step 6: Smoke test — kiosk full-screen**

```bash
npm run dev
```

Open http://localhost:5173 and click "Planner" in the bottom nav. Verify:
- Page goes full-screen (no header, no bottom nav)
- Clock visible and ticking in top bar
- Weather shows if configured
- Member avatars centered above columns
- Time-grid shows today's events with colored blocks
- Red now-line visible and scrolled into view
- Bottom split shows today's meal and task list
- Food strip at bottom shows 7-day cards with today highlighted
- Today/Uge toggle switches between time-grid and week-grid
- Week-grid shows day rows × member columns with weather icons on each day
- ☰ button returns to Dashboard

- [ ] **Step 7: Integration tests (backend unaffected — run to confirm)**

```bash
npm run test:integration
```

Expected: all pass (backend unchanged)

- [ ] **Step 8: Final commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat(kiosk): wire KioskPlanner as full-screen takeover, remove PlannerView"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Global header: clock + date | Task 1 (SlimHeader), Task 4 (KioskTopBar) |
| Global header: weather pill | Task 1, Task 4 |
| Global header: Add + AI buttons | Task 1, Task 4 |
| Global header: no search/filter/notifs | Tasks 1 & 3 (not included) |
| Bottom nav replacing sidebar | Task 2, Task 3 |
| Planner: full-screen kiosk | Task 8 (early return) |
| Kiosk: today/week toggle | Task 4 (KioskTopBar), Task 7 |
| Kiosk: member avatar row over columns | Task 7 |
| Kiosk today: time-grid with member columns | Task 5 |
| Kiosk today: red now-line + auto-scroll | Task 5 |
| Kiosk today: hour grid lines | Task 5 |
| Kiosk today: event blocks by time + duration | Task 5 |
| Kiosk today: bottom split panel | Task 7 |
| Kiosk today: today's meal | Task 7 |
| Kiosk today: per-member task checklist | Task 7 |
| Kiosk week: day rows × member columns | Task 6 |
| Kiosk week: weather icon per day | Task 6 |
| Kiosk week: today row highlighted | Task 6 |
| Food strip: 7-day horizontal | Task 7 |
| Food strip: today card highlighted | Task 7 |
| ☰ exits kiosk | Task 4, Task 8 |
| app-sidebar.tsx kept (used by member page) | Not touched |

All spec requirements are covered.

**Type consistency check:**
- `KioskView` defined in `kiosk-top-bar.tsx`, re-exported and used consistently in `kiosk-planner.tsx`
- `WeatherDailyPoint` imported from `@/lib/api` in both `week-grid.tsx` and `kiosk-planner.tsx`
- `entryBelongsToMember` is defined locally in both `time-grid.tsx` and `week-grid.tsx` — intentional duplication to keep files independent (no shared util needed)
- `NavSection` defined in `bottom-nav.tsx`, the old inline type in `dashboard-app.tsx` must be removed to avoid conflict
