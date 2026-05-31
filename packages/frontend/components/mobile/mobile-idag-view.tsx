'use client';

import { useEffect, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Entry, FoodPlanItem, Member } from '@mental-load/contracts';
import { loadUpcomingOccurrences, loadFoodPlan } from '@/lib/api';
import { aulaGetItems } from '@/lib/aula-api';
import { cn } from '@/lib/utils';
import { MONTHS_DA } from '@/lib/calendar-utils';

const MEMBER_COLORS = ['#6d5efc','#ef4444','#22c55e','#f59e0b','#3b82f6','#8b5cf6','#ec4899','#f97316','#14b8a6','#6366f1'];

const FOOD_EMOJI: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', bøf: '🥩', ris: '🍚',
};

function foodEmoji(name: string) {
  const l = name.toLowerCase();
  for (const [k, e] of Object.entries(FOOD_EMOJI)) if (l.includes(k)) return e;
  return '🍽';
}

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function toISO(d: Date) { return d.toISOString().slice(0, 10); }

type AulaLesson = { memberId: string; title: string; startTime?: string; endTime?: string };

interface Props {
  members: Member[];
}

export function MobileIdagView({ members }: Props) {
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [food, setFood] = useState<FoodPlanItem[]>([]);
  const [aulaLessons, setAulaLessons] = useState<AulaLesson[]>([]);

  const selectedDate = useMemo(() => addDays(new Date(), offset), [offset]);
  const dateStr = useMemo(() => toISO(selectedDate), [selectedDate]);

  const dayLabel = offset === 0 ? 'I dag'
    : offset === 1 ? 'I morgen'
    : selectedDate.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });

  const fullDateLabel = selectedDate.toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // Load entries (30 days range covers any offset up to 30)
  useEffect(() => {
    loadUpcomingOccurrences(30).then(setEntries).catch(() => setEntries([]));
  }, []);

  // Load food plan for the week containing selectedDate
  useEffect(() => {
    const d = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate()));
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + diff);
    const weekStart = d.toISOString().slice(0, 10);
    loadFoodPlan(weekStart).then(r => setFood(r.items)).catch(() => setFood([]));
  }, [dateStr]);

  // Load Aula lessons for selected date
  useEffect(() => {
    const children = members.filter(m => m.role === 'child');
    if (children.length === 0) return;
    const lessons: AulaLesson[] = [];
    Promise.all(children.map(async child => {
      try {
        const { items } = await aulaGetItems({ type: 'calendar_lesson', memberId: child.id, date: dateStr, pageSize: 200 });
        const toHHMM = (iso: string) => iso ? new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' }) : undefined;
        for (const item of items) {
          const raw = item.raw_json as Record<string, unknown>;
          lessons.push({ memberId: child.id, title: String(raw.title ?? item.title ?? 'Lektion'), startTime: toHHMM(String(raw.startTime ?? '')), endTime: toHHMM(String(raw.endTime ?? '')) });
        }
      } catch { /* ignore */ }
    })).then(() => setAulaLessons([...lessons]));
  }, [dateStr, members.map(m => m.id).join(',')]);

  // Today's entries per member
  const dayEntries = useMemo(() =>
    entries.filter(e => {
      const s = new Date(e.startTime).toISOString().slice(0, 10);
      const en = new Date(e.endTime).toISOString().slice(0, 10);
      return s <= dateStr && en >= dateStr;
    }).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [entries, dateStr],
  );

  // Food for this day
  const dowEN = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][selectedDate.getDay()];
  const todayFood = food.find(f => f.day === dowEN);

  const colorByMemberId = Object.fromEntries(
    members.map((m, i) => [m.id, m.color ?? MEMBER_COLORS[i % MEMBER_COLORS.length]]),
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div>
          <div className="text-lg font-bold capitalize">{dayLabel}</div>
          <div className="text-xs text-muted-foreground capitalize">{fullDateLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffset(o => Math.max(0, o - 1))}
            disabled={offset === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOffset(o => Math.min(14, o + 1))}
            disabled={offset >= 14}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Member cards */}
      <div className="flex-1 overflow-y-auto pb-20 px-4 flex flex-col gap-3">
        {members.map(member => {
          const color = colorByMemberId[member.id];
          const memberEntries = dayEntries.filter(e => e.ownerMemberId === member.id);
          const memberAula = aulaLessons.filter(l => l.memberId === member.id);
          const hasAnything = memberEntries.length > 0 || memberAula.length > 0;

          return (
            <div key={member.id} className="rounded-xl border border-border/60 bg-card overflow-hidden">
              {/* Member header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-black text-white flex-shrink-0"
                  style={{ background: color }}
                >
                  {member.avatar ?? member.name.slice(0, 1)}
                </div>
                <span className="text-sm font-semibold">{member.name}</span>
                {!hasAnything && (
                  <span className="ml-auto text-xs text-muted-foreground/50">Fri dag</span>
                )}
              </div>

              {/* Aula lessons */}
              {memberAula.map((lesson, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0 bg-violet-50/40">
                  <div className="w-1.5 h-full rounded-full" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{lesson.title}</div>
                    {lesson.startTime && lesson.endTime && (
                      <div className="text-[11px] text-muted-foreground">{lesson.startTime} – {lesson.endTime} · Skole</div>
                    )}
                  </div>
                  <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Aula</span>
                </div>
              ))}

              {/* Calendar events */}
              {memberEntries.map(entry => {
                const start = new Date(entry.startTime);
                const end = new Date(entry.endTime);
                const timeStr = entry.allDay
                  ? 'Hele dagen'
                  : `${start.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}`;
                return (
                  <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0">
                    <div className="w-1.5 h-full min-h-[2rem] rounded-full flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{entry.title}</div>
                      <div className="text-[11px] text-muted-foreground">{timeStr}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Today's food */}
        {todayFood && (
          <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex items-center gap-3">
            <span className="text-2xl">{foodEmoji(todayFood.dishName)}</span>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Aftensmad</div>
              <div className="text-sm font-semibold">{todayFood.dishName}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
