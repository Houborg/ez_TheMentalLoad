'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry, Member, FoodPlanItem, AiSuggestion } from '@mental-load/contracts';
import type { WeatherDailyPoint } from '@/lib/api';
import { TimeGrid, type AulaLesson } from '@/components/time-grid';
import { WeekGrid } from '@/components/week-grid';
import { MealDetailSheet } from '@/components/meal-detail-sheet';
import { AiSuggestionCard } from '@/components/ai-suggestion-card';
import { AiConfirmationSheet } from '@/components/ai-confirmation-sheet';
import { aulaGetItems } from '@/lib/aula-api';
import { getMemberSchedule, getAiSuggestions, dismissAiSuggestion } from '@/lib/api';

const DAY_LABELS_SHORT: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons',
  thursday: 'Tor', friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};

const FOOD_EMOJI_MAP: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', grillret: '🥩',
  ris: '🍚', kartofler: '🥔', spaghetti: '🍝', bøf: '🥩',
};

function getFoodEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJI_MAP)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽';
}

const WEEKDAYS: FoodPlanItem['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

type Props = {
  members: Member[];
  entries: Entry[];
  memberColorById: Record<string, string>;
  foodPlanItems: FoodPlanItem[];
  weatherByDate: Record<string, WeatherDailyPoint>;
  onClickEntry?: (entry: Entry) => void;
  onOpenScheduleEditor?: (memberId: string) => void;
};

export function IDagView({ members, entries, memberColorById, foodPlanItems, weatherByDate, onClickEntry, onOpenScheduleEditor }: Props) {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [dayOffset, setDayOffset] = useState(0); // 0 = today, 1 = tomorrow, etc.
  const [selectedMeal, setSelectedMeal] = useState<FoodPlanItem | null>(null);
  const [aulaLessons, setAulaLessons] = useState<AulaLesson[]>([]);
  const [noScheduleChildIds, setNoScheduleChildIds] = useState<Set<string>>(new Set());
  const [foodSuggestions, setFoodSuggestions] = useState<AiSuggestion[]>([]);
  const [confirmingSuggestion, setConfirmingSuggestion] = useState<AiSuggestion | null>(null);

  // Compute selected date from offset
  const selectedDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return d;
  }, [dayOffset]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const selectedDateStr = selectedDate.toISOString().slice(0, 10);
  const isToday = dayOffset === 0;

  const selectedDayLabel = useMemo(() => {
    if (dayOffset === 0) return 'I dag';
    if (dayOffset === 1) return 'I morgen';
    return selectedDate.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });
  }, [dayOffset, selectedDate]);

  const todayDay = selectedDate
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase() as FoodPlanItem['day'];

  // Filter to entries that occur on the selected date — TimeGrid uses time only, not date
  const todayEntries = useMemo(() => {
    return entries.filter((e) => {
      const start = new Date(e.startTime).toISOString().slice(0, 10);
      const end = new Date(e.endTime).toISOString().slice(0, 10);
      return start <= selectedDateStr && end >= selectedDateStr;
    });
  }, [entries, selectedDateStr]);
  // Mon–Fri are school days (day 1–5)
  const todayDow = selectedDate.getDay();
  const isSchoolDay = todayDow >= 1 && todayDow <= 5;

  // Load school lessons for child members on school days.
  // Priority: useAulaSchedule===false → manual schedule only
  //           otherwise: Aula calendar_lesson → weekplan_lesson → manual schedule fallback → placeholder
  useEffect(() => {
    if (!isSchoolDay) return;
    const children = members.filter((m) => m.role === 'child');
    if (children.length === 0) return;

    Promise.all(
      children.map(async (child) => {
        try {
          // 1. If useAulaSchedule is explicitly false, skip Aula entirely
          if (child.useAulaSchedule === false) {
            const schedule = await getMemberSchedule(child.id);
            const dowJs = selectedDate.getDay(); // 0=Sun, 1=Mon...
            const todayDow = dowJs === 0 ? 7 : dowJs;
            const todayEntries = schedule.filter(e => e.dayOfWeek === todayDow);
            if (todayEntries.length === 0) return { childId: child.id, noSchedule: true, lessons: [] };
            return {
              childId: child.id,
              noSchedule: false,
              lessons: todayEntries.map(e => ({
                memberId: child.id,
                title: e.title,
                date: todayStr,
                startTime: e.startTime,
                endTime: e.endTime,
                confirmed: e.confirmed,
              } as AulaLesson)),
            };
          }

          // 2. Try Aula calendar_lesson
          const { items } = await aulaGetItems({ type: 'calendar_lesson', memberId: child.id, pageSize: 100 });
          const todayLessons = items.filter((item) => {
            const raw = item.raw_json as Record<string, unknown> | undefined;
            return String(raw?.startTime ?? '').startsWith(selectedDateStr);
          });

          if (todayLessons.length > 0) {
            return {
              childId: child.id, noSchedule: false,
              lessons: todayLessons.map((item) => {
                const raw = item.raw_json as Record<string, unknown>;
                const toHHMM = (iso: string) => {
                  if (!iso) return undefined;
                  return new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Copenhagen' });
                };
                return { memberId: child.id, title: String(raw.title ?? item.title ?? 'Lektion'), date: selectedDateStr, startTime: toHHMM(String(raw.startTime ?? '')), endTime: toHHMM(String(raw.endTime ?? '')), confirmed: (item as { confirmed?: boolean }).confirmed } as AulaLesson;
              }),
            };
          }

          // 3. Try weekplan_lesson
          const { items: wpItems } = await aulaGetItems({ type: 'weekplan_lesson', memberId: child.id, pageSize: 50 });
          const wpToday = wpItems.filter(i => (i.raw_json as Record<string, unknown>)?.date === selectedDateStr);
          if (wpToday.length > 0) {
            return {
              childId: child.id, noSchedule: false,
              lessons: wpToday.map(item => {
                const raw = item.raw_json as Record<string, unknown>;
                return { memberId: child.id, title: String(raw.title ?? item.title ?? 'Lektion'), date: String(raw.date ?? todayStr), startTime: raw.startTime ? String(raw.startTime) : undefined, endTime: raw.endTime ? String(raw.endTime) : undefined, confirmed: (item as { confirmed?: boolean }).confirmed } as AulaLesson;
              }),
            };
          }

          // 4. Aula empty — try manual schedule as fallback
          const schedule = await getMemberSchedule(child.id);
          const dowJs = selectedDate.getDay();
          const todayDow = dowJs === 0 ? 7 : dowJs;
          const manualToday = schedule.filter(e => e.dayOfWeek === todayDow);
          if (manualToday.length > 0) {
            return {
              childId: child.id, noSchedule: false,
              lessons: manualToday.map(e => ({ memberId: child.id, title: e.title, date: selectedDateStr, startTime: e.startTime, endTime: e.endTime, confirmed: e.confirmed } as AulaLesson)),
            };
          }

          return { childId: child.id, noSchedule: true, lessons: [] };
        } catch {
          return { childId: child.id, noSchedule: true, lessons: [] };
        }
      }),
    ).then((results) => {
      const noSchedule = new Set(results.filter(r => r.noSchedule).map(r => r.childId));
      setNoScheduleChildIds(noSchedule);
      const flat = results.flatMap(r => r.lessons);
      setAulaLessons(flat);
    });
  }, [selectedDateStr, isSchoolDay, members.map(m => m.id + (m.useAulaSchedule ?? true)).join(',')]);

  useEffect(() => {
    getAiSuggestions()
      .then(all => setFoodSuggestions(all.filter(s => s.category === 'food')))
      .catch(() => setFoodSuggestions([]));
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* View toggle + day navigator */}
      <div className="flex items-center gap-2">
        {/* Today / Uge toggle */}
        <div className="flex overflow-hidden rounded-lg border border-border">
          {(['today', 'week'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'px-4 py-1.5 text-xs font-bold transition-colors',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted/60',
              )}
            >
              {v === 'today' ? 'I dag' : 'Uge'}
            </button>
          ))}
        </div>

        {/* Day navigator — only visible in today view */}
        {view === 'today' && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={() => setDayOffset(o => Math.max(0, o - 1))}
              disabled={dayOffset === 0}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground disabled:opacity-30 hover:bg-muted/60 transition-colors"
              aria-label="Forrige dag"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className={cn('text-xs font-semibold px-1 min-w-[70px] text-center', isToday ? 'text-primary' : 'text-foreground')}>
              {selectedDayLabel}
            </span>
            <button
              type="button"
              onClick={() => setDayOffset(o => Math.min(14, o + 1))}
              disabled={dayOffset >= 14}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground disabled:opacity-30 hover:bg-muted/60 transition-colors"
              aria-label="Næste dag"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Member avatar column headers — w-14 matches TimeGrid time-axis width */}
      <div className="flex overflow-hidden rounded-xl border border-border bg-card">
        <div className="w-14 shrink-0" />
        {members.map((member) => {
          const color = memberColorById[member.id] ?? '#6d5efc';
          return (
            <div
              key={member.id}
              className="flex flex-1 flex-col items-center gap-1 border-l border-border/40 py-2.5 first:border-l-0"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-md"
                style={{ background: color }}
              >
                {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-[9px] font-bold text-muted-foreground">
                {member.name.split(' ')[0]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Time grid or week grid */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {view === 'today' ? (
          <TimeGrid
            members={members}
            entries={todayEntries}
            memberColorById={memberColorById}
            aulaLessons={aulaLessons}
            onClickEntry={onClickEntry}
          />
        ) : (
          <WeekGrid
            members={members}
            entries={entries}
            memberColorById={memberColorById}
            weatherByDate={weatherByDate}
          />
        )}
      </div>

      {isSchoolDay && noScheduleChildIds.size > 0 && (
        <div className="flex gap-3 px-1">
          {members.filter(m => m.role === 'child' && noScheduleChildIds.has(m.id)).map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenScheduleEditor?.(m.id)}
              className="flex-1 rounded-xl border border-dashed border-border py-3 text-center text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <div className="font-semibold">{m.name}</div>
              <div>Ingen skemadata</div>
              <div className="mt-0.5 text-primary">Tilføj manuelt →</div>
            </button>
          ))}
        </div>
      )}

      {/* Meal strip */}
      <div>
        <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          🍽 Madplan denne uge
        </div>
        <div className="flex gap-2">
          {WEEKDAYS.map((day) => {
            const item = foodPlanItems.find((f) => f.day === day);
            const isFoodToday = day === new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
            return (
              <button
                key={day}
                type="button"
                onClick={() => { if (item) setSelectedMeal(item); }}
                disabled={!item}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all',
                  isFoodToday
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/50',
                  !item && 'cursor-default opacity-50',
                )}
              >
                <span className={cn('text-[8px] font-bold', isFoodToday ? 'text-primary' : 'text-muted-foreground')}>
                  {DAY_LABELS_SHORT[day]}{isFoodToday ? ' ●' : ''}
                </span>
                <span className="text-lg leading-none">
                  {item ? getFoodEmoji(item.dishName) : '—'}
                </span>
                <span className="w-full truncate text-center text-[8px] font-bold text-foreground">
                  {item?.dishName.split(' ')[0] ?? ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <MealDetailSheet item={selectedMeal} onClose={() => setSelectedMeal(null)} />

      {foodSuggestions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">🤖 AI — madforslag</div>
          {foodSuggestions.map(s => (
            <AiSuggestionCard
              key={s.id}
              suggestion={s}
              onAccept={() => setConfirmingSuggestion(s)}
              onDismiss={(id) => { dismissAiSuggestion(id).catch(() => undefined); setFoodSuggestions(prev => prev.filter(x => x.id !== id)); }}
              onDismissPermanent={(sug) => { dismissAiSuggestion(sug.id).catch(() => undefined); setFoodSuggestions(prev => prev.filter(x => x.id !== sug.id)); }}
            />
          ))}
        </div>
      )}

      <AiConfirmationSheet
        suggestion={confirmingSuggestion}
        onClose={() => setConfirmingSuggestion(null)}
        onDone={(id) => { setFoodSuggestions(prev => prev.filter(x => x.id !== id)); }}
      />
    </div>
  );
}
