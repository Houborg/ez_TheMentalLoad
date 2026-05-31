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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <KioskTopBar
        view={kioskView}
        onViewChange={setKioskView}
        weatherForecast={weatherForecast}
        onAdd={onAdd}
        onAI={onAI}
        onExit={onExit}
      />

      {/* Member avatar row — only shown in today view (week grid has its own column layout) */}
      {kioskView === 'today' && (
        <div className="flex shrink-0 items-center border-b border-border bg-muted/30 py-2">
          {/* w-10 matches the time-axis column width inside TimeGrid */}
          <div className="w-10 shrink-0" />
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: `repeat(${members.length}, 1fr)` }}
          >
            {members.map((member) => {
              const color = memberColorById[member.id] ?? '#6366f1';
              return (
                <div key={member.id} className="flex items-center justify-center gap-2">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-lg"
                    style={{ background: color, boxShadow: `0 0 14px ${color}55` }}
                  >
                    {member.avatar ?? member.name[0].toUpperCase()}
                  </div>
                  <span className="text-[12px] font-semibold text-foreground/80">{member.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main view area */}
      {kioskView === 'today' ? (
        <>
          <TimeGrid
            members={members}
            memberColorById={memberColorById}
            entries={todayEntries}
          />

          {/* Bottom split: meal + tasks — fixed height so TimeGrid isn't starved */}
          <div className="grid shrink-0 grid-cols-2 border-t border-border" style={{ height: '26vh', minHeight: '120px' }}>
            {/* Today's meal */}
            <div className="flex flex-col overflow-y-auto border-r border-border px-4 py-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                🍽 Aftensmad i dag
              </div>
              {todayMeal ? (
                <>
                  <div className="text-sm font-bold text-foreground/90">{todayMeal.dishName}</div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground/50">Intet planlagt</div>
              )}
            </div>

            {/* Today's tasks */}
            <div className="flex flex-col overflow-y-auto px-4 py-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                ✅ Opgaver i dag
              </div>
              <div className="space-y-2">
                {members.map((member) => {
                  const timeline = timelineByMember[member.id];
                  const tasks: TimelineTaskInstance[] = timeline?.tasks ?? [];
                  const done = tasks.filter((t) => t.status === 'completed').length;
                  const color = memberColorById[member.id] ?? '#6366f1';
                  return (
                    <div key={member.id}>
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <div
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ background: color }}
                        >
                          {member.name[0].toUpperCase()}
                        </div>
                        <span className="text-[11px] font-semibold text-muted-foreground">{member.name}</span>
                        {tasks.length > 0 && (
                          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                            {done}/{tasks.length}
                          </span>
                        )}
                      </div>
                      {tasks.length === 0 ? (
                        <div className="pl-5.5 text-[10px] text-muted-foreground/50">Ingen opgaver</div>
                      ) : (
                        <div className="space-y-0.5 pl-5.5">
                          {tasks.slice(0, 3).map((task) => (
                            <div
                              key={task.id}
                              className={cn(
                                'flex items-center gap-1 text-[10px]',
                                task.status === 'completed' ? 'text-muted-foreground/40 line-through' : 'text-foreground/70',
                              )}
                            >
                              <span>{task.status === 'completed' ? '✓' : '·'}</span>
                              <span className="truncate">{task.title}</span>
                            </div>
                          ))}
                          {tasks.length > 3 && (
                            <div className="text-[10px] text-muted-foreground/50">+{tasks.length - 3} mere</div>
                          )}
                        </div>
                      )}
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

      {/* Food plan week strip — only render when there's at least one meal planned */}
      {foodPlan.length > 0 && (
        <div className="shrink-0 border-t border-border px-4 py-2">
          <div className="grid grid-cols-7 gap-1">
            {FOOD_PLAN_DAYS.map((day) => {
              const item = foodPlan.find((fp) => fp.day.toLowerCase() === day);
              const isToday = day === todayFoodPlanKey();
              return (
                <div
                  key={day}
                  className={cn(
                    'rounded-lg px-1.5 py-1.5 text-center',
                    isToday
                      ? 'border border-primary/50 bg-primary/20'
                      : item
                        ? 'bg-muted/30'
                        : 'border border-dashed border-border',
                  )}
                >
                  <div className={cn(
                    'text-[9px] font-bold uppercase tracking-wide',
                    isToday ? 'text-primary' : 'text-muted-foreground/60',
                  )}>
                    {FOOD_DAY_LABELS[day]}
                  </div>
                  <div className={cn(
                    'mt-0.5 truncate text-[10px] font-semibold leading-tight',
                    isToday ? 'text-foreground' : item ? 'text-foreground/70' : 'text-muted-foreground/40',
                  )}>
                    {item?.dishName ?? '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
