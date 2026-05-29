'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, BookOpen, Check } from 'lucide-react';
import { aulaGetItems, type AulaItem } from '@/lib/aula-api';
import { getMemberSchedule, confirmAulaItem, unconfirmAulaItem, confirmScheduleEntry, unconfirmScheduleEntry } from '@/lib/api';
import type { MemberScheduleEntry } from '@mental-load/contracts';

interface Props {
  memberId: string;
  memberName: string;
  memberColor?: string;
  useAulaSchedule?: boolean;
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

export function MemberSchoolSchedule({ memberId, memberColor }: Props) {
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [manualEntries, setManualEntries] = useState<MemberScheduleEntry[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      aulaGetItems({ type: 'calendar_lesson', memberId, pageSize: 200 }),
      aulaGetItems({ type: 'weekplan_lesson', memberId, pageSize: 200 }),
      getMemberSchedule(memberId),
    ]).then(([calRes, wpRes, manual]) => {
      if (!active) return;
      const allAula = [...calRes.items, ...wpRes.items];
      setItems(allAula);
      setManualEntries(manual);
      const confirmed = new Set<string>();
      allAula.forEach(i => { if ((i as { confirmed?: boolean }).confirmed) confirmed.add(i.id); });
      manual.forEach(e => { if (e.confirmed) confirmed.add(e.id); });
      setConfirmedIds(confirmed);
    }).catch(() => {
      if (active) { setItems([]); setManualEntries([]); }
    }).finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [memberId]);

  const weekLessonsByDay = useMemo(() => {
    const start = ymd(weekStart);
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + 5);

    const aulaThisWeek = items.filter(i => {
      if (!i.published_at) return false;
      const d = i.published_at.slice(0, 10);
      return d >= start && d < ymd(endDate);
    });

    const manualThisWeek = manualEntries.map(e => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + (e.dayOfWeek - 1));
      return { ...e, _dateStr: ymd(dayDate) };
    });

    const byDay: Record<string, Array<{ id: string; title: string; time?: string; isManual: boolean }>> = {};
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key = ymd(d);
      const aulaDay = aulaThisWeek
        .filter(it => it.published_at!.slice(0, 10) === key)
        .map(it => ({ id: it.id, title: it.title ?? 'Lektion', time: (it.raw_json as { startTime?: string })?.startTime ?? undefined, isManual: false }));
      const manualDay = manualThisWeek
        .filter(e => e._dateStr === key)
        .map(e => ({ id: e.id, title: e.title, time: e.startTime, isManual: true }));
      byDay[key] = [...aulaDay, ...manualDay].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    }
    return byDay;
  }, [items, manualEntries, weekStart]);

  // Return null if there's no school data at all for this member (parents, daycare).
  if (!loading && items.length === 0 && manualEntries.length === 0) return null;

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
      ) : (
        <div className="space-y-2">
          {Object.entries(weekLessonsByDay).map(([dayKey, lessons], idx) => (
            <div key={dayKey} className="rounded-2xl border border-border/60 bg-card/50 p-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                {WEEKDAY_LABELS[idx]}
              </div>
              {lessons.length === 0 ? (
                <div className="text-xs text-muted-foreground">Ingen lektioner</div>
              ) : (
                <div className="space-y-1">
                  {lessons.map(lesson => {
                    const isConfirmed = confirmedIds.has(lesson.id);
                    const toggle = async () => {
                      if (lesson.isManual) {
                        if (isConfirmed) {
                          await unconfirmScheduleEntry(memberId, lesson.id);
                          setConfirmedIds(prev => { const s = new Set(prev); s.delete(lesson.id); return s; });
                        } else {
                          await confirmScheduleEntry(memberId, lesson.id);
                          setConfirmedIds(prev => new Set([...prev, lesson.id]));
                        }
                      } else {
                        if (isConfirmed) {
                          await unconfirmAulaItem(lesson.id);
                          setConfirmedIds(prev => { const s = new Set(prev); s.delete(lesson.id); return s; });
                        } else {
                          await confirmAulaItem(lesson.id);
                          setConfirmedIds(prev => new Set([...prev, lesson.id]));
                        }
                      }
                    };
                    return (
                      <div key={lesson.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent">
                        <button
                          type="button"
                          onClick={toggle}
                          aria-label={isConfirmed ? 'Fjern bekræftelse' : 'Bekræft lektion'}
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            isConfirmed
                              ? 'border-transparent text-white'
                              : 'border-muted-foreground/40 text-transparent'
                          }`}
                          style={isConfirmed ? { background: memberColor ?? '#6d5efc' } : {}}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">{lesson.time ?? '—'}</span>
                        <span className={`flex-1 text-sm font-medium ${isConfirmed ? 'text-muted-foreground line-through' : ''}`}>
                          {lesson.title}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
