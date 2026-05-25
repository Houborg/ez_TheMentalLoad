'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import { aulaGetItems, type AulaItem } from '@/lib/aula-api';
import { cn } from '@/lib/utils';

interface Props {
  memberId: string;
  memberName: string;
}

const WEEKDAY_LABELS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];

function isoWeekNumber(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === ymd(new Date());
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function formatDayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
}

function ExpandableNote({ item }: { item: AulaItem }) {
  const [expanded, setExpanded] = useState(false);
  const body = item.body ?? '';
  const hasLongBody = body.length > 100;
  const raw = item.raw_json as { source?: string } | undefined;

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-3 py-2.5">
      <div className="text-sm font-semibold">{item.title || 'Note'}</div>
      {body && (
        <p
          className={cn(
            'mt-1 text-xs text-muted-foreground leading-relaxed',
            !expanded && 'line-clamp-2',
          )}
        >
          {body}
        </p>
      )}
      {hasLongBody && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[11px] font-semibold text-primary hover:underline"
        >
          {expanded ? 'Læs mindre' : 'Læs mere…'}
        </button>
      )}
      {raw?.source && (
        <span className="mt-1.5 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary/80">
          {raw.source}
        </span>
      )}
    </div>
  );
}

export function MemberWeekNotes({ memberId, memberName }: Props) {
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));

  useEffect(() => {
    let active = true;
    setLoading(true);
    aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 })
      .then(res => { if (active) setItems(res.items); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId]);

  // Filter to items that have a body (actual notes, not just schedule entries)
  const weekNotes = useMemo(() => {
    const start = ymd(weekStart);
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 5);
    const end = ymd(endDate);
    return items
      .filter(i => i.published_at && i.body && i.body.trim().length > 0)
      .filter(i => {
        const d = i.published_at!.slice(0, 10);
        return d >= start && d < end;
      })
      .sort((a, b) => {
        const ad = (a.published_at ?? '').slice(0, 10) + ((a.raw_json as { startTime?: string })?.startTime ?? '');
        const bd = (b.published_at ?? '').slice(0, 10) + ((b.raw_json as { startTime?: string })?.startTime ?? '');
        return ad.localeCompare(bd);
      });
  }, [items, weekStart]);

  const weekNo = isoWeekNumber(weekStart);

  return (
    <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Uge noter</h2>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-1 text-sm">
          <button
            type="button"
            aria-label="Forrige uge"
            onClick={() => {
              const prev = new Date(weekStart);
              prev.setDate(prev.getDate() - 7);
              setWeekStart(prev);
            }}
            className="rounded-md p-1 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-1 font-medium">Uge {weekNo}</span>
          <button
            type="button"
            aria-label="Næste uge"
            onClick={() => {
              const next = new Date(weekStart);
              next.setDate(next.getDate() + 7);
              setWeekStart(next);
            }}
            className="rounded-md p-1 hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Henter noter…</p>
      ) : (
        <div className="space-y-3">
          {WEEKDAY_LABELS.map((label, idx) => {
            const dayDate = new Date(weekStart);
            dayDate.setDate(dayDate.getDate() + idx);
            const dayKey = ymd(dayDate);
            const dayNotes = weekNotes.filter(i => (i.published_at ?? '').slice(0, 10) === dayKey);
            const today = isToday(dayKey);

            return (
              <div key={dayKey}>
                <div
                  className={cn(
                    'mb-1.5 text-xs font-semibold uppercase tracking-wide',
                    today ? 'text-green-500' : 'text-primary',
                  )}
                >
                  {label} {formatDayDate(dayKey)}
                </div>
                {dayNotes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                    Ingen noter
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {dayNotes.map(note => (
                      <ExpandableNote key={note.id} item={note} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
