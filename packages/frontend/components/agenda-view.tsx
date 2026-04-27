import type { Entry, Member } from '@mental-load/contracts';
import { CalendarDays, Check, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

type AgendaViewProps = {
  members: Member[];
  entries: Entry[];
  memberColorById: Record<string, string>;
  onSelectEntry?: (entry: Entry) => void;
  onSelectDate?: (date: Date, ownerMemberId?: string) => void;
  dayWeatherByDate?: Record<string, { temp: number; unitLabel: string; icon: string }>;
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function AgendaView({ members, entries, memberColorById, onSelectEntry, onSelectDate, dayWeatherByDate }: AgendaViewProps) {
  const weekDays = getNextSevenDays();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            <th className="border border-border/60 bg-card/70 p-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Day</th>
            {members.map((member) => (
              <th key={member.id} className="border border-border/60 bg-card/70 p-2 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-[13px] normal-case text-foreground">
                    {member.avatar || '👤'}
                  </span>
                  <span>{member.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekDays.map((day) => (
            <tr key={day.toISOString()}>
              <td
                className="cursor-pointer border border-border/60 bg-card/55 p-2 align-top transition hover:bg-accent/45"
                role="button"
                tabIndex={0}
                onClick={() => onSelectDate?.(day)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectDate?.(day);
                  }
                }}
              >
                <div className="text-xs font-semibold">{DAY_LABELS[getWeekdayIndex(day)]}</div>
                <div className="text-xs text-muted-foreground">{day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                {dayWeatherByDate?.[toDateKey(day)] ? (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    <span>{dayWeatherByDate[toDateKey(day)].icon}</span>
                    <span>{dayWeatherByDate[toDateKey(day)].temp}°{dayWeatherByDate[toDateKey(day)].unitLabel}</span>
                  </div>
                ) : null}
              </td>
              {members.map((member) => {
                const cellEntries = entries.filter((entry) => entry.ownerMemberId === member.id && isSameCalendarDate(new Date(entry.startTime), day));

                return (
                  <td
                    key={`${day.toISOString()}-${member.id}`}
                    className="min-w-[150px] cursor-pointer border border-border/60 bg-card/40 p-2 align-top transition hover:bg-accent/35"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectDate?.(day, member.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectDate?.(day, member.id);
                      }
                    }}
                  >
                    <div className="space-y-1">
                      {cellEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectEntry?.(entry);
                          }}
                          className={cn(
                            'w-full rounded-full border px-2.5 py-1 text-left text-[10px] font-semibold transition hover:brightness-95',
                            entry.type === 'task'
                              ? entry.status === 'completed'
                                ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'border-amber-500/45 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'border-primary/40 bg-primary/15 text-primary',
                          )}
                          title={entry.title}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={cn('h-1.5 w-1.5 rounded-full', memberColorById[member.id] ?? 'bg-primary')} />
                            {entry.type === 'task' ? (
                              entry.status === 'completed' ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />
                            ) : (
                              <CalendarDays className="h-3 w-3" />
                            )}
                            <span className={cn('truncate', entry.type === 'task' && entry.status === 'completed' && 'line-through')}>
                              {formatEntryPillLabel(entry)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getNextSevenDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() + index);
    return day;
  });
}

function getWeekdayIndex(date: Date) {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function isSameCalendarDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatEntryPillLabel(entry: Entry) {
  const timeRange = formatEntryTimeRange(entry);
  return timeRange ? `${timeRange} ${entry.title}` : entry.title;
}

function formatEntryTimeRange(entry: Entry) {
  if (entry.allDay) {
    return 'All day';
  }

  const start = new Date(entry.startTime);
  const end = new Date(entry.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return '';
  }

  const formatTime = (value: Date) => value.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `${formatTime(start)}-${formatTime(end)}`;
}
