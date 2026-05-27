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

/** Returns the 7 days of the current week starting from Monday */
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
