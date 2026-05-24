'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { aulaGetItems, type AulaItem } from '@/lib/aula-api';
import { LessonDetailSheet } from './lesson-detail-sheet';

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
  const day = (out.getDay() + 6) % 7;  // 0=Mon … 6=Sun
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

export function MemberSchoolSchedule({ memberId }: Props) {
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [selectedLesson, setSelectedLesson] = useState<AulaItem | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 })
      .then(res => { if (active) setItems(res.items); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId]);

  const weekItems = useMemo(() => {
    const start = ymd(weekStart);
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 5);
    const end = ymd(endDate);
    return items
      .filter(i => i.published_at)
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

  // Return null if there's no school data at all for this member (parents, daycare).
  if (!loading && items.length === 0) return null;

  const weekNo = isoWeekNumber(weekStart);

  return (
    <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Skoleskema</h2>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border/60 px-2 py-1 text-sm">
          <button
            type="button" aria-label="Forrige uge"
            onClick={() => {
              const prev = new Date(weekStart);
              prev.setDate(prev.getDate() - 7);
              setWeekStart(prev);
            }}
            className="rounded-md p-1 hover:bg-accent"
          ><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-1 font-medium">Uge {weekNo}</span>
          <button
            type="button" aria-label="Næste uge"
            onClick={() => {
              const next = new Date(weekStart);
              next.setDate(next.getDate() + 7);
              setWeekStart(next);
            }}
            className="rounded-md p-1 hover:bg-accent"
          ><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Henter skema…</p>
      ) : weekItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ingen ugeplan for uge {weekNo}.</p>
      ) : (
        <div className="space-y-2">
          {WEEKDAY_LABELS.map((label, idx) => {
            const dayDate = new Date(weekStart);
            dayDate.setDate(dayDate.getDate() + idx);
            const dayKey = ymd(dayDate);
            const lessons = weekItems.filter(i => (i.published_at ?? '').slice(0, 10) === dayKey);
            return (
              <div key={dayKey} className="rounded-2xl border border-border/60 bg-card/50 p-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                  {label}
                </div>
                {lessons.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Ingen lektioner</div>
                ) : (
                  <div className="space-y-1">
                    {lessons.map(lesson => {
                      const time = (lesson.raw_json as { startTime?: string })?.startTime;
                      return (
                        <button
                          key={lesson.id}
                          type="button"
                          onClick={() => setSelectedLesson(lesson)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-accent"
                        >
                          <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                            {time ?? '—'}
                          </span>
                          <span className="font-medium">{lesson.title || 'Lektion'}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LessonDetailSheet item={selectedLesson} onClose={() => setSelectedLesson(null)} />
    </section>
  );
}
