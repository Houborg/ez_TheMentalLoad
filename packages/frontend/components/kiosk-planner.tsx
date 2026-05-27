'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Entry, FoodPlanItem, Member, TimelineTaskInstance, TodayMemberTimeline } from '@mental-load/contracts';
import {
  getWeekStart,
  loadFoodPlan,
  loadMonthOccurrences,
  loadSettings,
  loadTodayTimeline,
  loadWeatherForecast,
  type WeatherDailyPoint,
  type WeatherForecastResponse,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { KioskTopBar, type KioskView } from '@/components/kiosk-top-bar';
import { TimeGrid } from '@/components/time-grid';
import { WeekGrid } from '@/components/week-grid';

// ── helpers ───────────────────────────────────────────────────────────────────

const FOOD_PLAN_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

const FOOD_DAY_LABELS: Record<string, string> = {
  monday: 'Man', tuesday: 'Tir', wednesday: 'Ons', thursday: 'Tor',
  friday: 'Fre', saturday: 'Lør', sunday: 'Søn',
};

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayFoodPlanKey(): string {
  const d = new Date();
  // getDay: 0=Sun … 6=Sat  →  FOOD_PLAN_DAYS index: 0=Mon … 6=Sun
  return FOOD_PLAN_DAYS[(d.getDay() + 6) % 7];
}

function isoToDateKey(iso: string): string {
  return iso.slice(0, 10);
}

// ── types ─────────────────────────────────────────────────────────────────────

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  onAdd: () => void;
  onAI: () => void;
  onExit: () => void;
};

// ── component ─────────────────────────────────────────────────────────────────

export function KioskPlanner({ members, memberColorById, onAdd, onAI, onExit }: Props) {
  const [kioskView, setKioskView] = useState<KioskView>('today');
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [foodPlan, setFoodPlan] = useState<FoodPlanItem[]>([]);
  const [timelineByMember, setTimelineByMember] = useState<Record<string, TodayMemberTimeline>>({});
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const now = new Date();
        const [entries, weekFood, settings] = await Promise.all([
          loadMonthOccurrences(now),
          loadFoodPlan(getWeekStart(now)),
          loadSettings(),
        ]);

        // Load weather
        const w = (settings.sync.configJson.weather ?? {}) as Record<string, unknown>;
        if (typeof w.location === 'string' && w.location) {
          try {
            const forecast = await loadWeatherForecast({
              location: w.location,
              state: typeof w.state === 'string' ? w.state : undefined,
              country: typeof w.country === 'string' ? w.country : undefined,
              unit: w.unit === 'F' ? 'F' : 'C',
              days: 7,
            });
            if (active) setWeatherForecast(forecast);
          } catch { /* non-critical */ }
        }

        // Load today's timeline per member
        const timelines = await Promise.all(
          members.map((m) => loadTodayTimeline(m.id).then((r) => ({ id: m.id, tl: r.timeline }))),
        );

        if (!active) return;
        setAllEntries(entries);
        setFoodPlan(weekFood.items);
        setTimelineByMember(
          Object.fromEntries(timelines.map(({ id, tl }) => [id, tl])),
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [members]);

  // Entries for today only
  const todayEntries = useMemo(
    () => allEntries.filter((e) => isoToDateKey(e.startTime) === todayDateKey()),
    [allEntries],
  );

  // Weather by date map for WeekGrid
  const weatherByDate = useMemo<Record<string, WeatherDailyPoint>>(() => {
    if (!weatherForecast) return {};
    return Object.fromEntries(weatherForecast.daily.map((d) => [d.date, d]));
  }, [weatherForecast]);

  // Today's food plan item
  const todayMeal = foodPlan.find((fp) => fp.day.toLowerCase() === todayFoodPlanKey());

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1a]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#0f0f1a] text-white">
      <KioskTopBar
        view={kioskView}
        onViewChange={setKioskView}
        weatherForecast={weatherForecast}
        onAdd={onAdd}
        onAI={onAI}
        onExit={onExit}
      />

      {/* Member avatar row — centered over columns */}
      <div className="flex shrink-0 items-center border-b border-white/7 py-2.5">
        {/* Offset matching time-axis width (only shown on today view) */}
        {kioskView === 'today' && <div className="w-9 shrink-0" />}
        {/* Member axis offset for week view */}
        {kioskView === 'week' && <div className="w-14 shrink-0" />}
        <div
          className="grid flex-1 gap-1 pr-2"
          style={{ gridTemplateColumns: `repeat(${members.length}, 1fr)` }}
        >
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-center gap-1.5">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: memberColorById[member.id] ?? '#6366f1' }}
              >
                {member.avatar ?? member.name[0].toUpperCase()}
              </div>
              <span className="hidden text-[11px] text-white/50 sm:block">{member.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main view area */}
      {kioskView === 'today' ? (
        <>
          <TimeGrid
            members={members}
            memberColorById={memberColorById}
            entries={todayEntries}
          />

          {/* Bottom split: meal + tasks */}
          <div className="grid shrink-0 grid-cols-2 border-t border-white/7">
            {/* Today's meal */}
            <div className="border-r border-white/7 px-4 py-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                🍽 Aftensmad i dag
              </div>
              {todayMeal ? (
                <>
                  <div className="text-sm font-bold text-white/85">{todayMeal.dishName}</div>
                  {todayMeal.groceryList.length > 0 && (
                    <div className="mt-1 text-xs text-white/35">
                      {todayMeal.groceryList.join(' · ')}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-white/20">Intet planlagt</div>
              )}
            </div>

            {/* Today's tasks */}
            <div className="px-4 py-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                ✅ Opgaver i dag
              </div>
              <div className="space-y-2">
                {members.map((member) => {
                  const timeline = timelineByMember[member.id];
                  const tasks: TimelineTaskInstance[] = timeline?.tasks ?? [];
                  if (tasks.length === 0) return null;
                  return (
                    <div key={member.id} className="flex items-start gap-2">
                      <div
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: memberColorById[member.id] ?? '#6366f1' }}
                      >
                        {member.name[0].toUpperCase()}
                      </div>
                      <div className="space-y-0.5">
                        {tasks.map((task) => (
                          <div
                            key={task.id}
                            className={cn(
                              'flex items-center gap-1 text-xs',
                              task.status === 'completed' ? 'text-white/25 line-through' : 'text-white/65',
                            )}
                          >
                            <span className="text-[10px]">
                              {task.status === 'completed' ? '✓' : '○'}
                            </span>
                            {task.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <WeekGrid
          members={members}
          memberColorById={memberColorById}
          entries={allEntries}
          weatherByDate={weatherByDate}
        />
      )}

      {/* Food plan strip — always visible at bottom */}
      <div className="shrink-0 border-t border-white/7 px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
          Madplan · Denne uge
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {FOOD_PLAN_DAYS.map((day) => {
            const item = foodPlan.find((fp) => fp.day.toLowerCase() === day);
            const isToday = day === todayFoodPlanKey();
            return (
              <div
                key={day}
                className={cn(
                  'rounded-lg px-1.5 py-2 text-center',
                  isToday
                    ? 'border border-primary/30 bg-primary/15'
                    : item
                      ? 'bg-white/5'
                      : 'border border-dashed border-white/8 bg-white/2',
                )}
              >
                <div className={cn('mb-1 text-[9px] font-bold', isToday ? 'text-primary/70' : 'text-white/25')}>
                  {FOOD_DAY_LABELS[day]}
                </div>
                <div className={cn('text-[10px] font-semibold leading-tight', isToday ? 'text-primary/90' : item ? 'text-white/60' : 'text-white/15')}>
                  {item?.dishName ?? '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
