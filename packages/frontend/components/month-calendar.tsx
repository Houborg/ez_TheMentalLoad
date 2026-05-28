'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry } from '@mental-load/contracts';

const DAYS_DA = ['Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør', 'Søn'];

type Props = {
  month: Date;
  entries: Entry[];
  memberColorById: Record<string, string>;
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onClickEntry?: (entry: Entry) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

/** Returns YYYY-MM-DD string in local time */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Build a CSS gradient or solid colour from 1–4 member colours */
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

/** Returns the Monday of the week containing d */
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const result = new Date(d);
  result.setDate(d.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

type RenderedEntry = {
  entry: Entry;
  colors: string[];
  startDateStr: string;
  endDateStr: string;
  isMultiDay: boolean;
};

export function MonthCalendar({ month, entries, memberColorById, selectedDate, onSelectDate, onClickEntry, onPrevMonth, onNextMonth }: Props) {
  // Build 6-week grid starting from Monday of the week containing 1st of month
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

  // Pre-process entries: resolve member colours, compute date strings
  const rendered = useMemo<RenderedEntry[]>(() => {
    return entries.map((entry) => {
      const ownerColor = memberColorById[entry.ownerMemberId] ?? '#6d5efc';
      const visibleIds = entry.visibleMemberIds ?? [];
      const allIds = Array.from(new Set([entry.ownerMemberId, ...visibleIds]));
      const colors = allIds.map((id) => memberColorById[id] ?? ownerColor).slice(0, 4);

      const startDate = new Date(entry.startTime);
      // all-day end times are exclusive in iCal convention — subtract 1ms
      const endDate = entry.allDay
        ? new Date(new Date(entry.endTime).getTime() - 1)
        : new Date(entry.endTime);

      const startDateStr = toLocalDateStr(startDate);
      const endDateStr = toLocalDateStr(endDate);

      return { entry, colors, startDateStr, endDateStr, isMultiDay: startDateStr !== endDateStr };
    });
  }, [entries, memberColorById]);

  const monthLabel = month.toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });
  const selectedStr = toLocalDateStr(selectedDate);
  const todayStr = toLocalDateStr(new Date());

  // Hide the 6th week row if all days are in the next month
  const visibleWeeks = weeks.filter((week, i) =>
    i < 5 || week.some((d) => d.getMonth() === month.getMonth()),
  );

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

        const weekEntries = rendered.filter(
          (r) => r.endDateStr >= weekStartStr && r.startDateStr <= weekEndStr,
        );

        // Separate single-day and multi-day entries
        const spanning = weekEntries.filter((r) => r.isMultiDay);
        const singleByDate: Record<string, RenderedEntry[]> = {};
        weekEntries
          .filter((r) => !r.isMultiDay)
          .forEach((r) => {
            singleByDate[r.startDateStr] = [...(singleByDate[r.startDateStr] ?? []), r];
          });

        return (
          <div
            key={weekStartStr}
            className="relative grid grid-cols-7 border-b border-border/30 last:border-b-0"
            style={{ minHeight: `${22 + spanning.length * 18 + 36}px` }}
          >
            {week.map((day) => {
              const dayStr = toLocalDateStr(day);
              const isToday = dayStr === todayStr;
              const isSelected = dayStr === selectedStr;
              const isCurrentMonth = day.getMonth() === month.getMonth();
              const singles = (singleByDate[dayStr] ?? []).slice(0, 2);
              const overflow = (singleByDate[dayStr] ?? []).length - 2;

              return (
                <div
                  key={dayStr}
                  onClick={() => onSelectDate(day)}
                  className={cn(
                    'border-r border-border/20 last:border-r-0 cursor-pointer px-0.5 pt-1 pb-1',
                    !isCurrentMonth && 'bg-muted/20',
                    isSelected && !isToday && 'bg-primary/5',
                  )}
                >
                  {/* Day number row */}
                  <div className="flex items-center justify-between px-1 mb-0.5">
                    <span className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                      isToday
                        ? 'bg-foreground text-background'
                        : isCurrentMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground/40',
                    )}>
                      {day.getDate()}
                    </span>
                    {overflow > 0 && (
                      <span className="text-[8px] text-muted-foreground/50 font-medium">+{overflow} mere</span>
                    )}
                  </div>
                  {/* Spacer — pushes single-day pills below the spanning event lanes */}
                  <div aria-hidden="true" style={{ height: `${spanning.length * 18}px` }} />
                  {/* Single-day pills */}
                  <div className="flex flex-col gap-[2px] px-0.5">
                    {singles.map((r) => (
                      <button
                        key={r.entry.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onClickEntry?.(r.entry); }}
                        className="block w-full truncate rounded-full px-1.5 py-[1px] text-[9px] font-bold text-white leading-tight text-left hover:brightness-110 transition-[filter]"
                        style={{ background: memberGradient(r.colors) }}
                        title={r.entry.title}
                      >
                        {r.entry.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Spanning event pills — absolutely positioned within the week row */}
            {spanning.map((r, si) => {
              const clampedStart = r.startDateStr < weekStartStr ? weekStartStr : r.startDateStr;
              const clampedEnd = r.endDateStr > weekEndStr ? weekEndStr : r.endDateStr;

              const colStart = week.findIndex((d) => toLocalDateStr(d) === clampedStart);
              const colEnd = week.findIndex((d) => toLocalDateStr(d) === clampedEnd);
              if (colStart < 0 || colEnd < 0) return null;

              const isFirstDay = r.startDateStr >= weekStartStr;
              const isLastDay = r.endDateStr <= weekEndStr;
              const spanCols = colEnd - colStart + 1;
              const laneTop = 22 + si * 18; // px from top of row

              return (
                <button
                  key={`${r.entry.id}-${wi}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClickEntry?.(r.entry); }}
                  className="absolute flex items-center overflow-hidden text-[9px] font-bold text-white leading-none hover:brightness-110 transition-[filter]"
                  style={{
                    top: `${laneTop}px`,
                    height: '16px',
                    left: `calc(${colStart} / 7 * 100%)`,
                    width: `calc(${spanCols} / 7 * 100%)`,
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
                    cursor: 'pointer',
                  }}
                  title={r.entry.title}
                >
                  {isFirstDay ? r.entry.title : ''}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
