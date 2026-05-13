# Mobile UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bolted-on mobile layout with a purpose-built Apple Calendar-style shell: month grid + day list, 4-tab bottom nav, AI quick-add, bottom sheet event detail, task list, food planner, and a "Mere" overflow sheet.

**Architecture:** New components live in `packages/frontend/components/mobile/`. `dashboard-app.tsx` uses a `useMobile` hook to conditionally mount `MobileShell` (mobile) or the existing desktop layout — both are independent trees. All mobile components fetch their own data; no prop-drilling from the 4000-line desktop component.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, TypeScript, lucide-react, existing `@mental-load/contracts` types and `lib/api.ts` functions.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/frontend/lib/calendar-utils.ts` | Month grid, date helpers extracted from dashboard-app |
| Create | `packages/frontend/lib/use-mobile.ts` | `useMobile()` hook |
| Create | `packages/frontend/components/mobile/bottom-sheet.tsx` | Reusable bottom sheet primitive |
| Create | `packages/frontend/components/mobile/mobile-nav.tsx` | 4-tab bottom nav (replaces top-level mobile-nav.tsx) |
| Create | `packages/frontend/components/mobile/mobile-calendar-view.tsx` | Kalender tab — month grid + day event list |
| Create | `packages/frontend/components/mobile/mobile-event-sheet.tsx` | Event detail bottom sheet |
| Create | `packages/frontend/components/mobile/mobile-quick-add.tsx` | 3-stage add-event flow |
| Create | `packages/frontend/components/mobile/mobile-task-list.tsx` | Opgaver tab |
| Create | `packages/frontend/components/mobile/mobile-food-planner.tsx` | Mad tab |
| Create | `packages/frontend/components/mobile/mobile-more-sheet.tsx` | Mere ··· overflow sheet |
| Create | `packages/frontend/components/mobile/mobile-shell.tsx` | Assembles all tabs + nav |
| Modify | `packages/frontend/components/dashboard-app.tsx` | Add `useMobile` + conditional render |
| Modify | `packages/frontend/components/mobile-nav.tsx` | Remove (replaced by mobile/mobile-nav.tsx) |

---

## Task 1: Extract calendar utils + useMobile hook

**Files:**
- Create: `packages/frontend/lib/calendar-utils.ts`
- Create: `packages/frontend/lib/use-mobile.ts`

- [ ] **Step 1: Create calendar-utils.ts**

```typescript
// packages/frontend/lib/calendar-utils.ts

export const DAYS_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];
export const MONTHS_DA = [
  'Januar', 'Februar', 'Marts', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'December',
];

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

export function nextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function isToday(date: Date): boolean {
  return sameDay(date, new Date());
}

/**
 * Returns a 6-row × 7-col grid. Cells are day numbers (1-31) or null for padding.
 * Week starts on Monday.
 */
export function buildMonthGrid(date: Date): (number | null)[][] {
  const first = startOfMonth(date);
  // Monday=0 … Sunday=6
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = endOfMonth(date).getDate();
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}
```

- [ ] **Step 2: Create use-mobile.ts**

```typescript
// packages/frontend/lib/use-mobile.ts
'use client';

import { useEffect, useState } from 'react';

export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/lib/calendar-utils.ts packages/frontend/lib/use-mobile.ts
git commit -m "feat(mobile): add calendar-utils and useMobile hook"
```

---

## Task 2: BottomSheet primitive

**Files:**
- Create: `packages/frontend/components/mobile/bottom-sheet.tsx`

- [ ] **Step 1: Create bottom-sheet.tsx**

```tsx
// packages/frontend/components/mobile/bottom-sheet.tsx
'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
};

export function BottomSheet({ open, onClose, children, className }: BottomSheetProps) {
  // Prevent body scroll while open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 rounded-t-2xl bg-card border-t border-border',
          'max-h-[90vh] overflow-y-auto',
          className,
        )}
        role="dialog"
        aria-modal="true"
      >
        {/* Drag handle */}
        <div className="mx-auto mt-3 mb-1 h-1 w-8 rounded-full bg-muted-foreground/30" />
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/bottom-sheet.tsx
git commit -m "feat(mobile): add BottomSheet primitive"
```

---

## Task 3: MobileNav (4-tab bottom nav)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-nav.tsx`

- [ ] **Step 1: Create mobile-nav.tsx**

```tsx
// packages/frontend/components/mobile/mobile-nav.tsx
'use client';

import { CalendarDays, CheckSquare, ChefHat, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileTab = 'kalender' | 'opgaver' | 'mad' | 'mere';

type MobileNavProps = {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
};

const TABS: Array<{ key: MobileTab; label: string; Icon: typeof CalendarDays }> = [
  { key: 'kalender', label: 'Kalender', Icon: CalendarDays },
  { key: 'opgaver',  label: 'Opgaver',  Icon: CheckSquare },
  { key: 'mad',      label: 'Mad',      Icon: ChefHat },
  { key: 'mere',     label: 'Mere',     Icon: MoreHorizontal },
];

export function MobileNav({ active, onSelect }: MobileNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card/95 backdrop-blur pb-safe"
      aria-label="Mobilnavigation"
    >
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-[10px] font-medium transition-colors',
            active === key ? 'text-primary' : 'text-muted-foreground',
          )}
          aria-current={active === key ? 'page' : undefined}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-nav.tsx
git commit -m "feat(mobile): 4-tab MobileNav component"
```

---

## Task 4: MobileCalendarView (Kalender tab)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-calendar-view.tsx`

- [ ] **Step 1: Create mobile-calendar-view.tsx**

```tsx
// packages/frontend/components/mobile/mobile-calendar-view.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Calendar, Entry, Member } from '@mental-load/contracts';
import { loadMonthOccurrences } from '@/lib/api';
import {
  buildMonthGrid, DAYS_DA, MONTHS_DA,
  nextMonth, previousMonth, sameDay, formatDayHeading, formatTimeRange,
} from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';

type Props = {
  members: Member[];
  calendars: Calendar[];
  onAddEntry: () => void;
  onSelectEntry: (entry: Entry) => void;
};

export function MobileCalendarView({ members, calendars, onAddEntry, onSelectEntry }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    loadMonthOccurrences(currentMonth).then(setEntries).catch(console.error);
  }, [currentMonth]);

  const monthGrid = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  const dotsForDay = useCallback((day: number) => {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dayEntries = entries.filter(e => sameDay(new Date(e.startTime), d));
    const colors = [...new Set(
      dayEntries
        .map(e => calendars.find(c => c.id === e.calendarId)?.color)
        .filter(Boolean)
    )].slice(0, 3) as string[];
    return colors;
  }, [entries, currentMonth, calendars]);

  const selectedEntries = useMemo(() =>
    entries.filter(e => sameDay(new Date(e.startTime), selectedDate))
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [entries, selectedDate]
  );

  const isToday = (day: number) => {
    const now = new Date();
    return now.getFullYear() === currentMonth.getFullYear()
      && now.getMonth() === currentMonth.getMonth()
      && now.getDate() === day;
  };

  const isSelected = (day: number) =>
    selectedDate.getFullYear() === currentMonth.getFullYear()
    && selectedDate.getMonth() === currentMonth.getMonth()
    && selectedDate.getDate() === day;

  const calendarColor = (entry: Entry) =>
    calendars.find(c => c.id === entry.calendarId)?.color ?? '#6d5efc';

  const memberName = (entry: Entry) =>
    members.find(m => m.id === entry.ownerMemberId)?.name ?? '';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold">
          {MONTHS_DA[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentMonth(previousMonth(currentMonth))}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
            aria-label="Forrige måned"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(nextMonth(currentMonth))}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
            aria-label="Næste måned"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onAddEntry}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground ml-1"
            aria-label="Tilføj begivenhed"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Month grid — collapsible */}
      {!collapsed && (
        <div className="px-3 pb-1">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS_DA.map(d => (
              <div key={d} className="text-center text-[10px] text-muted-foreground py-1">{d}</div>
            ))}
          </div>
          {/* Weeks */}
          {monthGrid.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day, di) => {
                if (!day) return <div key={di} />;
                const dots = dotsForDay(day);
                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => setSelectedDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))}
                    className="flex flex-col items-center py-0.5"
                  >
                    <span className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full text-sm',
                      isToday(day) && !isSelected(day) && 'bg-primary/20 text-primary font-semibold',
                      isSelected(day) && 'bg-primary text-primary-foreground font-semibold',
                      !isToday(day) && !isSelected(day) && 'text-foreground',
                    )}>
                      {day}
                    </span>
                    <div className="flex gap-0.5 h-1">
                      {dots.map((color, i) => (
                        <span key={i} className="w-1 h-1 rounded-full" style={{ background: color }} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-center py-1 text-muted-foreground"
        aria-label={collapsed ? 'Udvid kalender' : 'Skjul kalender'}
      >
        <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
      </button>

      {/* Day events list */}
      <div className="flex-1 overflow-y-auto pb-20">
        <div className="px-4 py-2 text-sm font-semibold text-muted-foreground capitalize">
          {formatDayHeading(selectedDate)}
        </div>
        {selectedEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Ingen begivenheder denne dag
          </div>
        ) : (
          <div className="px-4 flex flex-col gap-2">
            {selectedEntries.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectEntry(entry)}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-left w-full"
              >
                <div
                  className="mt-1 w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ background: calendarColor(entry) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{entry.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {entry.allDay ? 'Heldagsbegivenhed' : formatTimeRange(entry.startTime, entry.endTime)}
                    {memberName(entry) ? ` · ${memberName(entry)}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-calendar-view.tsx
git commit -m "feat(mobile): MobileCalendarView — month grid + day event list"
```

---

## Task 5: MobileEventSheet (event detail bottom sheet)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-event-sheet.tsx`

- [ ] **Step 1: Create mobile-event-sheet.tsx**

```tsx
// packages/frontend/components/mobile/mobile-event-sheet.tsx
'use client';

import { useState } from 'react';
import { Calendar, Clock, MapPin, Bell, RefreshCw, Trash2, Edit2, Check } from 'lucide-react';
import type { Calendar as CalendarType, Entry, Member } from '@mental-load/contracts';
import { deleteEntry, updateEntry } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';
import { formatTimeRange, MONTHS_DA } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';

type Props = {
  entry: Entry | null;
  members: Member[];
  calendars: CalendarType[];
  onClose: () => void;
  onEdit: (entry: Entry) => void;
  onDeleted: () => void;
};

export function MobileEventSheet({ entry, members, calendars, onClose, onEdit, onDeleted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!entry) return null;

  const calendar = calendars.find(c => c.id === entry.calendarId);
  const owner = members.find(m => m.id === entry.ownerMemberId);
  const color = calendar?.color ?? '#6d5efc';

  const startDate = new Date(entry.startTime);
  const dateLabel = `${startDate.getDate()}. ${MONTHS_DA[startDate.getMonth()]} ${startDate.getFullYear()}`;

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteEntry(entry.id);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleTask(taskId: string, done: boolean) {
    const updatedTasks = (entry.tasks ?? []).map(t =>
      t.id === taskId ? { ...t, done } : t
    );
    await updateEntry(entry.id, { tasks: updatedTasks });
  }

  return (
    <BottomSheet open={!!entry} onClose={onClose}>
      <div className="px-4 pb-8 pt-2">
        {/* Title row */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
          <h2 className="text-xl font-bold flex-1 leading-tight">{entry.title}</h2>
        </div>

        {/* Detail rows */}
        <div className="flex flex-col gap-3 mb-5">
          <div className="flex items-start gap-3 text-sm">
            <Clock className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <div>
              <div>{dateLabel}</div>
              {!entry.allDay && <div className="text-muted-foreground">{formatTimeRange(entry.startTime, entry.endTime)}</div>}
            </div>
          </div>

          {entry.location && (
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{entry.location}</span>
            </div>
          )}

          {owner && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                {owner.name[0]}
              </div>
              <span>{owner.name}</span>
            </div>
          )}

          {entry.reminders && entry.reminders.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <Bell className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{entry.reminders[0].minutesBefore} min før</span>
            </div>
          )}

          {entry.recurrenceRule && (
            <div className="flex items-center gap-3 text-sm">
              <RefreshCw className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>Gentages</span>
            </div>
          )}
        </div>

        {/* Inline checklist */}
        {entry.tasks && entry.tasks.length > 0 && (
          <div className="mb-5 rounded-xl border border-border/60 divide-y divide-border/40">
            {entry.tasks.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleToggleTask(task.id, !task.done)}
                className="flex items-center gap-3 px-3 py-2.5 w-full text-left"
              >
                <div className={cn(
                  'h-4 w-4 rounded flex items-center justify-center border flex-shrink-0',
                  task.done ? 'bg-primary border-primary' : 'border-muted-foreground',
                )}>
                  {task.done && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <span className={cn('text-sm', task.done && 'line-through text-muted-foreground')}>
                  {task.text}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            <Edit2 className="h-4 w-4" />
            Rediger
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
              confirmDelete
                ? 'bg-destructive text-destructive-foreground flex-1'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? 'Bekræft sletning' : ''}
          </button>
        </div>
        {confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="mt-2 w-full text-center text-sm text-muted-foreground py-1"
          >
            Annuller
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-event-sheet.tsx
git commit -m "feat(mobile): MobileEventSheet — bottom sheet event detail + inline checklist"
```

---

## Task 6: MobileQuickAdd (3-stage add-event flow)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-quick-add.tsx`

- [ ] **Step 1: Create mobile-quick-add.tsx**

```tsx
// packages/frontend/components/mobile/mobile-quick-add.tsx
'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2, ChevronRight } from 'lucide-react';
import type { AssistantDraft, Calendar, Entry, Member } from '@mental-load/contracts';
import { parseAssistant, confirmAssistant, createEntry } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';
import { cn } from '@/lib/utils';

type Stage = 'ai' | 'quick' | 'full';

type Props = {
  open: boolean;
  onClose: () => void;
  members: Member[];
  calendars: Calendar[];
  onCreated: (entry: Entry) => void;
  onOpenFull: (draft?: Partial<AssistantDraft>) => void;
};

export function MobileQuickAdd({ open, onClose, members, calendars, onCreated, onOpenFull }: Props) {
  const [stage, setStage] = useState<Stage>('ai');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const defaultMember = members[0];
  const defaultCalendar = calendars[0];

  function handleClose() {
    setText('');
    setDraft(null);
    setStage('ai');
    setParseError(null);
    onClose();
  }

  async function handleParse() {
    if (!text.trim() || !defaultMember || !defaultCalendar) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await parseAssistant({
        message: text,
        memberId: defaultMember.id,
        calendarId: defaultCalendar.id,
        language: 'da',
      });
      setDraft(res.draft);
      setStage('quick');
    } catch {
      setParseError('Kunne ikke fortolke teksten. Udfyld manuelt.');
      setDraft(null);
      setStage('quick');
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      let entry: Entry;
      if (draft.startTime) {
        const confirmed = await confirmAssistant({ draft });
        entry = confirmed;
      } else {
        entry = await createEntry({
          title: draft.title,
          type: draft.type ?? 'event',
          ownerMemberId: draft.ownerMemberId || defaultMember?.id || '',
          calendarId: draft.calendarId || defaultCalendar?.id || '',
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
          allDay: draft.allDay,
          timezone: draft.timezone || 'Europe/Copenhagen',
          reminders: [],
          tasks: [],
          invitees: [],
        });
      }
      onCreated(entry);
      handleClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div className="px-4 pb-8 pt-2">
        {stage === 'ai' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-sm">Tilføj hurtigt</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Skriv hvad der skal ske — fx "Tandlæge fredag kl 14 med Lars"
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleParse()}
                placeholder="Hvad sker der?"
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleParse}
                disabled={!text.trim() || parsing}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStage('quick')}
              className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"
            >
              Udfyld manuelt <ChevronRight className="h-3 w-3" />
            </button>
          </>
        )}

        {stage === 'quick' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">
                {draft?.title ? 'Bekræft begivenhed' : 'Ny begivenhed'}
              </h2>
              {parseError && <span className="text-xs text-destructive">{parseError}</span>}
            </div>

            {/* Title */}
            <input
              autoFocus
              value={draft?.title ?? ''}
              onChange={e => setDraft(d => d ? { ...d, title: e.target.value } : {
                title: e.target.value,
                type: 'event',
                ownerMemberId: defaultMember?.id ?? '',
                calendarId: defaultCalendar?.id ?? '',
                timezone: 'Europe/Copenhagen',
                allDay: false,
                reminders: [],
              })}
              placeholder="Titel"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
            />

            {/* Date + time pills */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                {draft?.startTime
                  ? new Date(draft.startTime).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })
                  : '📅 Dato'}
              </div>
              <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                {draft?.startTime && !draft.allDay
                  ? new Date(draft.startTime).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
                  : '🕐 Tid'}
              </div>
            </div>

            {/* Member avatars */}
            <div className="flex gap-2 mb-4">
              {members.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft(d => d ? { ...d, ownerMemberId: m.id } : null)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all',
                    draft?.ownerMemberId === m.id
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {m.name[0]}
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!draft?.title || saving}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {saving ? 'Gemmer…' : 'Gem'}
              </button>
              <button
                type="button"
                onClick={() => onOpenFull(draft ?? undefined)}
                className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground"
              >
                Mere
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStage('ai')}
              className="mt-2 w-full text-center text-xs text-muted-foreground py-1"
            >
              ← Skriv igen
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-quick-add.tsx
git commit -m "feat(mobile): MobileQuickAdd — AI parse → quick form → full form"
```

---

## Task 7: MobileTaskList (Opgaver tab)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-task-list.tsx`

- [ ] **Step 1: Create mobile-task-list.tsx**

```tsx
// packages/frontend/components/mobile/mobile-task-list.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Entry, Member } from '@mental-load/contracts';
import { loadUpcomingOccurrences, updateEntry } from '@/lib/api';
import { sameDay } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';

type Props = {
  members: Member[];
  onAddTask: () => void;
  onSelectEntry: (entry: Entry) => void;
};

type Group = { label: string; entries: Entry[] };

function groupTasks(tasks: Entry[]): Group[] {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - now.getDay()));

  const today: Entry[] = [];
  const thisWeek: Entry[] = [];
  const upcoming: Entry[] = [];
  const noDate: Entry[] = [];

  for (const t of tasks) {
    if (!t.startTime) { noDate.push(t); continue; }
    const d = new Date(t.startTime);
    if (sameDay(d, now)) today.push(t);
    else if (d <= endOfWeek) thisWeek.push(t);
    else if (d <= new Date(now.getTime() + 30 * 86400000)) upcoming.push(t);
    else noDate.push(t);
  }

  return [
    { label: 'I dag', entries: today },
    { label: 'Denne uge', entries: thisWeek },
    { label: 'Kommende', entries: upcoming },
    { label: 'Uden dato', entries: noDate },
  ].filter(g => g.entries.length > 0);
}

export function MobileTaskList({ members, onAddTask, onSelectEntry }: Props) {
  const [allTasks, setAllTasks] = useState<Entry[]>([]);
  const [filterMemberId, setFilterMemberId] = useState<string | 'all'>('all');
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUpcomingOccurrences(60)
      .then(entries => setAllTasks(entries.filter(e => e.type === 'task')))
      .catch(console.error);
  }, []);

  const filtered = useMemo(() =>
    filterMemberId === 'all'
      ? allTasks
      : allTasks.filter(t => t.ownerMemberId === filterMemberId),
    [allTasks, filterMemberId]
  );

  const groups = useMemo(() => groupTasks(filtered), [filtered]);

  async function toggleDone(entry: Entry) {
    const done = entry.status !== 'done';
    setCompleting(s => new Set(s).add(entry.id));
    setAllTasks(prev => prev.map(t => t.id === entry.id ? { ...t, status: done ? 'done' : 'pending' } : t));
    try {
      await updateEntry(entry.id, { status: done ? 'done' : 'pending' });
    } catch {
      // revert on error
      setAllTasks(prev => prev.map(t => t.id === entry.id ? { ...t, status: entry.status } : t));
    } finally {
      setCompleting(s => { const n = new Set(s); n.delete(entry.id); return n; });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header + add */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold">Opgaver</h1>
        <button
          type="button"
          onClick={onAddTask}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label="Tilføj opgave"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Member filter */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        <button
          type="button"
          onClick={() => setFilterMemberId('all')}
          className={cn(
            'flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium',
            filterMemberId === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          Alle
        </button>
        {members.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setFilterMemberId(m.id)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              filterMemberId === m.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/30 text-[9px]">{m.name[0]}</span>
            {m.name}
          </button>
        ))}
      </div>

      {/* Task groups */}
      <div className="flex-1 overflow-y-auto pb-20 px-4">
        {groups.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Ingen opgaver</p>
        )}
        {groups.map(group => (
          <div key={group.label} className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label} ({group.entries.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {group.entries.map(entry => {
                const done = entry.status === 'done';
                const member = members.find(m => m.id === entry.ownerMemberId);
                return (
                  <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleDone(entry)}
                      disabled={completing.has(entry.id)}
                      className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors',
                        done ? 'border-primary bg-primary' : 'border-muted-foreground',
                      )}
                      aria-label={done ? 'Markér som ikke udført' : 'Markér som udført'}
                    >
                      {done && <svg className="h-3 w-3 text-white" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectEntry(entry)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className={cn('text-sm truncate', done && 'line-through text-muted-foreground')}>
                        {entry.title}
                      </div>
                    </button>
                    {member && (
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold">
                        {member.name[0]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-task-list.tsx
git commit -m "feat(mobile): MobileTaskList — grouped task list with member filter"
```

---

## Task 8: MobileFoodPlanner (Mad tab)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-food-planner.tsx`

- [ ] **Step 1: Create mobile-food-planner.tsx**

```tsx
// packages/frontend/components/mobile/mobile-food-planner.tsx
'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FoodPlanItem } from '@mental-load/contracts';
import { loadFoodPlan, updateFoodPlan, deleteFoodPlan } from '@/lib/api';
import { getWeekStart } from '@/lib/api';
import { MONTHS_DA } from '@/lib/calendar-utils';
import { BottomSheet } from './bottom-sheet';

const DAYS_DA_FULL = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function MobileFoodPlanner() {
  const [weekStart, setWeekStart] = useState(() => toWeekStart(new Date()));
  const [items, setItems] = useState<FoodPlanItem[]>([]);
  const [editDay, setEditDay] = useState<number | null>(null); // 0=Mon…6=Sun
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFoodPlan(weekStart).then(r => setItems(r.items)).catch(console.error);
  }, [weekStart]);

  const weekStartDate = new Date(weekStart);
  const weekLabel = `${weekStartDate.getDate()}. ${MONTHS_DA[weekStartDate.getMonth()]}`;
  const weekEndDate = addDays(weekStartDate, 6);
  const weekEndLabel = `${weekEndDate.getDate()}. ${MONTHS_DA[weekEndDate.getMonth()]}`;

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function itemForDay(dayIndex: number): FoodPlanItem | undefined {
    const date = addDays(weekStartDate, dayIndex).toISOString().slice(0, 10);
    return items.find(i => i.date === date);
  }

  function openEdit(dayIndex: number) {
    setEditDay(dayIndex);
    setEditText(itemForDay(dayIndex)?.meal ?? '');
  }

  async function saveEdit() {
    if (editDay === null) return;
    setSaving(true);
    const date = addDays(weekStartDate, editDay).toISOString().slice(0, 10);
    try {
      if (editText.trim()) {
        await updateFoodPlan({ weekStart, date, meal: editText.trim() });
        setItems(prev => {
          const filtered = prev.filter(i => i.date !== date);
          return [...filtered, { id: crypto.randomUUID(), weekStart, date, meal: editText.trim() }];
        });
      } else {
        const existing = itemForDay(editDay);
        if (existing) {
          await deleteFoodPlan({ weekStart, date });
          setItems(prev => prev.filter(i => i.date !== date));
        }
      }
      setEditDay(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h1 className="text-lg font-bold">Madplan</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button type="button" onClick={prevWeek} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" aria-label="Forrige uge">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs">{weekLabel} – {weekEndLabel}</span>
          <button type="button" onClick={nextWeek} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" aria-label="Næste uge">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Day cards */}
      <div className="flex-1 overflow-y-auto pb-20 px-4 flex flex-col gap-2">
        {DAYS_DA_FULL.map((dayName, i) => {
          const item = itemForDay(i);
          const date = addDays(weekStartDate, i);
          const isToday = new Date().toDateString() === date.toDateString();
          return (
            <button
              key={i}
              type="button"
              onClick={() => openEdit(i)}
              className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-left w-full"
            >
              <div>
                <div className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                  {dayName}
                  {isToday && <span className="ml-2 text-xs font-normal text-primary">i dag</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {date.getDate()}. {MONTHS_DA[date.getMonth()]}
                </div>
              </div>
              <div className="text-sm text-right max-w-[55%] truncate">
                {item ? (
                  <span className="text-foreground">{item.meal}</span>
                ) : (
                  <span className="text-muted-foreground/50">Ingen plan</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Edit sheet */}
      <BottomSheet open={editDay !== null} onClose={() => setEditDay(null)}>
        <div className="px-4 pb-8 pt-2">
          <h2 className="font-semibold mb-3">
            {editDay !== null ? DAYS_DA_FULL[editDay] : ''}
          </h2>
          <input
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveEdit()}
            placeholder="Hvad skal vi spise?"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            {editDay !== null && itemForDay(editDay) && (
              <button
                type="button"
                onClick={() => { setEditText(''); saveEdit(); }}
                className="flex items-center gap-1 rounded-xl border border-border px-4 py-3 text-sm text-destructive"
              >
                <X className="h-4 w-4" /> Slet
              </button>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-food-planner.tsx
git commit -m "feat(mobile): MobileFoodPlanner — week strip + day cards"
```

---

## Task 9: MobileMoreSheet (Mere ··· overflow)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-more-sheet.tsx`

- [ ] **Step 1: Create mobile-more-sheet.tsx**

```tsx
// packages/frontend/components/mobile/mobile-more-sheet.tsx
'use client';

import { Clock, Users, Sparkles, Settings } from 'lucide-react';
import { BottomSheet } from './bottom-sheet';

type MoreSection = 'idag' | 'familie' | 'assistent' | 'indstillinger';

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate: (section: MoreSection) => void;
};

const TILES: Array<{ key: MoreSection; label: string; Icon: typeof Clock }> = [
  { key: 'idag',          label: 'I dag',         Icon: Clock },
  { key: 'familie',       label: 'Familie',        Icon: Users },
  { key: 'assistent',     label: 'Assistent',      Icon: Sparkles },
  { key: 'indstillinger', label: 'Indstillinger',  Icon: Settings },
];

export function MobileMoreSheet({ open, onClose, onNavigate }: Props) {
  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-4 pb-8 pt-2">
        <h2 className="text-sm font-semibold text-muted-foreground mb-4">Mere</h2>
        <div className="grid grid-cols-2 gap-3">
          {TILES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { onNavigate(key); onClose(); }}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card py-5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <Icon className="h-6 w-6 text-primary" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-more-sheet.tsx
git commit -m "feat(mobile): MobileMoreSheet — 2×2 tile overflow nav"
```

---

## Task 10: MobileShell (assembles all tabs)

**Files:**
- Create: `packages/frontend/components/mobile/mobile-shell.tsx`

- [ ] **Step 1: Create mobile-shell.tsx**

```tsx
// packages/frontend/components/mobile/mobile-shell.tsx
'use client';

import { useState } from 'react';
import type { AssistantDraft, Calendar, Entry, Member } from '@mental-load/contracts';
import { MobileNav, type MobileTab } from './mobile-nav';
import { MobileCalendarView } from './mobile-calendar-view';
import { MobileTaskList } from './mobile-task-list';
import { MobileFoodPlanner } from './mobile-food-planner';
import { MobileEventSheet } from './mobile-event-sheet';
import { MobileQuickAdd } from './mobile-quick-add';
import { MobileMoreSheet } from './mobile-more-sheet';
import { TodayTimelineBoard } from '@/components/today-timeline-board';

type MoreSection = 'idag' | 'familie' | 'assistent' | 'indstillinger';

type Props = {
  members: Member[];
  calendars: Calendar[];
  onRefresh: () => void;
  onNavigateDesktopSection: (section: string) => void;
};

export function MobileShell({ members, calendars, onRefresh, onNavigateDesktopSection }: Props) {
  const [activeTab, setActiveTab] = useState<MobileTab>('kalender');
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection | null>(null);

  function handleTabSelect(tab: MobileTab) {
    if (tab === 'mere') { setMoreOpen(true); return; }
    setActiveTab(tab);
  }

  function handleMoreNavigate(section: MoreSection) {
    setMoreSection(section);
    setMoreOpen(false);
  }

  function handleEntryCreated() {
    onRefresh();
    setQuickAddOpen(false);
  }

  function handleEntryDeleted() {
    onRefresh();
    setSelectedEntry(null);
  }

  function handleOpenFull(_draft?: Partial<AssistantDraft>) {
    // Fall back to full desktop form — navigate to dashboard section
    setQuickAddOpen(false);
    onNavigateDesktopSection('dashboard');
  }

  // "Mere" sub-sections rendered as full-screen overlays
  if (moreSection) {
    return (
      <div className="fixed inset-0 z-30 bg-background flex flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setMoreSection(null)}
            className="text-sm text-primary"
          >
            ← Tilbage
          </button>
          <h1 className="font-semibold capitalize">
            {moreSection === 'idag' ? 'I dag' :
             moreSection === 'familie' ? 'Familie' :
             moreSection === 'assistent' ? 'Assistent' : 'Indstillinger'}
          </h1>
        </div>
        <div className="flex-1 overflow-auto pb-6">
          {/* Delegate to the existing desktop sections via a message to the parent */}
          <div className="px-4 pt-6 text-center text-sm text-muted-foreground">
            {moreSection === 'idag' && members[0] && (
              <TodayTimelineBoard
                memberId={members[0].id}
                members={members}
                onEntrySelect={setSelectedEntry}
              />
            )}
            {moreSection !== 'idag' && (
              <p>Åbner {moreSection}…</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'kalender' && (
          <MobileCalendarView
            members={members}
            calendars={calendars}
            onAddEntry={() => setQuickAddOpen(true)}
            onSelectEntry={setSelectedEntry}
          />
        )}
        {activeTab === 'opgaver' && (
          <MobileTaskList
            members={members}
            onAddTask={() => setQuickAddOpen(true)}
            onSelectEntry={setSelectedEntry}
          />
        )}
        {activeTab === 'mad' && <MobileFoodPlanner />}
      </div>

      {/* Bottom nav */}
      <MobileNav active={activeTab} onSelect={handleTabSelect} />

      {/* Sheets */}
      <MobileEventSheet
        entry={selectedEntry}
        members={members}
        calendars={calendars}
        onClose={() => setSelectedEntry(null)}
        onEdit={entry => {
          setSelectedEntry(null);
          onNavigateDesktopSection('dashboard');
        }}
        onDeleted={handleEntryDeleted}
      />

      <MobileQuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        members={members}
        calendars={calendars}
        onCreated={handleEntryCreated}
        onOpenFull={handleOpenFull}
      />

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNavigate={handleMoreNavigate}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/mobile/mobile-shell.tsx
git commit -m "feat(mobile): MobileShell — assembles all tabs and sheets"
```

---

## Task 11: Wire into dashboard-app.tsx

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Add imports at top of dashboard-app.tsx**

After the existing imports, add:

```typescript
import { useMobile } from '@/lib/use-mobile';
import { MobileShell } from '@/components/mobile/mobile-shell';
```

- [ ] **Step 2: Add useMobile hook inside the component**

After the existing `useState` declarations (around line 151), add:

```typescript
const isMobile = useMobile();
```

- [ ] **Step 3: Replace the return statement's outer div**

Find the current return (around line 1675):

```tsx
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MobileNav activeSection={activeNav} />
      <div className="flex min-h-screen">
```

Replace with:

```tsx
  return (
    <div className="min-h-screen bg-background text-foreground">
      {isMobile ? (
        <MobileShell
          members={dashboard.members}
          calendars={dashboard.calendars}
          onRefresh={() => loadMonthOccurrences(currentMonth).then(entries =>
            setDashboard(d => ({ ...d, entries }))
          ).catch(console.error)}
          onNavigateDesktopSection={(section) => {
            setActiveNav(section as NavSection);
          }}
        />
      ) : (
      <>
      <div className="flex min-h-screen">
```

And close the ternary at the very end of the JSX, just before the final `</div>`:

```tsx
      </div>
      </>
      )}
    </div>
  );
```

- [ ] **Step 4: Remove the top-level MobileNav import and usage**

Remove the `<MobileNav activeSection={activeNav} />` line (it was between the outer div and the flex div) — it's now inside `MobileShell`.

Remove the import at the top:
```typescript
import { MobileNav } from '@/components/mobile-nav';
```

- [ ] **Step 5: Typecheck**

```bash
cd packages/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Start dev server and verify on mobile viewport**

```bash
npm run dev
```

Open `http://localhost:5173` in Chrome DevTools with a mobile viewport (iPhone 12 375×844). Verify:
- Bottom nav shows Kalender · Opgaver · Mad · Mere
- Kalender tab shows month grid
- Tapping a day shows events below
- `+` button opens AI quick-add sheet
- Tapping an event opens detail bottom sheet
- Opgaver tab shows task list
- Mad tab shows food planner
- Mere tab opens sheet with 4 tiles
- Desktop layout (> 768px) is unchanged

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat(mobile): wire MobileShell into dashboard-app via useMobile hook"
```

---

## Final: Push and deploy

- [ ] **Push to GitHub**

```bash
git push origin main
```

- [ ] **Deploy to production**

```bash
ssh mhouborg@192.168.1.252 "/home/mhouborg/redeploy-mentalload.sh"
```

- [ ] **Verify on device**

Open `https://mentalload.pl0k.online` on a real phone. Check all 4 tabs work, add an event via AI quick-add, tap an event to see the detail sheet.

---

## Self-Review Notes

- `getWeekStart` is imported from `@/lib/api` in `MobileFoodPlanner` — confirm this export exists before running Task 8. If not, use the inline `toWeekStart` helper defined in the same file.
- `TodayTimelineBoard` props (`memberId`, `members`, `onEntrySelect`) — verify against actual component interface in `today-timeline-board.tsx` before Task 10, adjust if needed.
- The `MobileShell` `moreSection` overlay for `familie`, `assistent`, `indstillinger` currently shows a placeholder message. These can be fleshed out in a follow-up — the shell structure is correct, it just needs the actual section components wired in.
- Desktop layout wrapping in Task 11 adds one extra `<>` fragment — check JSX nesting carefully when editing.
