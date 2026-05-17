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
  onAddEntry: (date: Date) => void;
  onSelectEntry: (entry: Entry) => void;
  refreshKey?: number;
};

export function MobileCalendarView({ members, calendars, onAddEntry, onSelectEntry, refreshKey }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    loadMonthOccurrences(currentMonth).then(setEntries).catch(console.error);
  }, [currentMonth, refreshKey]);

  const monthGrid = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  const dotsForDay = useCallback((day: number) => {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    // Only show event dots — task occurrences don't clutter the grid
    const dayEntries = entries.filter(e => e.type === 'event' && sameDay(new Date(e.startTime), d));
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
            onClick={() => onAddEntry(selectedDate)}
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
        <div aria-hidden="true" className="h-1 w-8 rounded-full bg-muted-foreground/30" />
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
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm truncate">{entry.title}</span>
                    {entry.type === 'task' && (
                      <span className="flex-shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        opgave
                      </span>
                    )}
                  </div>
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
