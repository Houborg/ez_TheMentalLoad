'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Edit2, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import type { Entry, FoodPlanDay, FoodPlanItem, Member } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { cn } from '@/lib/utils';
import {
  deleteFoodPlan,
  getWeekStart,
  loadDashboardSnapshot,
  loadFoodPlan,
  loadSettings,
  loadUpcomingOccurrences,
  loadWeatherForecast,
  updateFoodPlan,
  type WeatherForecastResponse,
} from '@/lib/api';

const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

type FoodPlanDraft = {
  weekStart: string;
  day: FoodPlanDay;
  dishName: string;
  groceryInput: string;
};

export default function PlannerPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [weatherConfig, setWeatherConfig] = useState({ location: '', state: '', country: '', unit: 'C' as 'C' | 'F' });
  const [foodPlan, setFoodPlan] = useState<FoodPlanItem[]>([]);
  const [deletingFoodPlan, setDeletingFoodPlan] = useState<{ weekStart: string; day: FoodPlanDay } | null>(null);
  const [foodPlanComposerOpen, setFoodPlanComposerOpen] = useState(false);
  const [foodPlanDraft, setFoodPlanDraft] = useState<FoodPlanDraft | null>(null);
  const [foodPlanEditingKey, setFoodPlanEditingKey] = useState<string | null>(null);
  const [foodPlanSaving, setFoodPlanSaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadPlanner() {
      try {
        setErrorText('');
        const [snapshot, upcoming, weekFoodPlan] = await Promise.all([
          loadDashboardSnapshot(),
          loadUpcomingOccurrences(7),
          loadFoodPlan(getWeekStart()),
        ]);

        const settings = await loadSettings();
        const rawWeather = settings.sync.configJson.weather;
        const resolvedWeather = {
          location: typeof (rawWeather as Record<string, unknown> | undefined)?.location === 'string' ? (rawWeather as Record<string, string>).location : '',
          state: typeof (rawWeather as Record<string, unknown> | undefined)?.state === 'string' ? (rawWeather as Record<string, string>).state : '',
          country: typeof (rawWeather as Record<string, unknown> | undefined)?.country === 'string' ? (rawWeather as Record<string, string>).country : '',
          unit: (rawWeather as Record<string, unknown> | undefined)?.unit === 'F' ? 'F' as const : 'C' as const,
        };

        if (resolvedWeather.location) {
          const forecast = await loadWeatherForecast({
            location: resolvedWeather.location,
            state: resolvedWeather.state,
            country: resolvedWeather.country,
            unit: resolvedWeather.unit,
            days: 7,
          });

          if (active) {
            setWeatherForecast(forecast);
          }
        }

        if (!active) {
          return;
        }

        setMembers(snapshot.members);
        setEntries(upcoming);
        setWeatherConfig(resolvedWeather);
        setFoodPlan(weekFoodPlan.items);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : 'Could not load planner overview');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPlanner();
    return () => {
      active = false;
    };
  }, []);

  const memberColorById = useMemo(() => {
    return members.reduce<Record<string, string>>((accumulator, member, index) => {
      accumulator[member.id] = MEMBER_COLOR_CLASSES[index % MEMBER_COLOR_CLASSES.length];
      return accumulator;
    }, {});
  }, [members]);

  const dayWeatherByDate = useMemo(() => {
    if (!weatherForecast) {
      return {} as Record<string, { temp: number; unitLabel: string; icon: string }>;
    }

    return weatherForecast.daily.reduce<Record<string, { temp: number; unitLabel: string; icon: string }>>((accumulator, day) => {
      accumulator[day.date] = {
        temp: Math.round(day.tempMax),
        unitLabel: weatherForecast.unit,
        icon: day.icon,
      };
      return accumulator;
    }, {});
  }, [weatherForecast]);

  async function handleDeleteFoodPlan(weekStart: string, day: FoodPlanDay) {
    try {
      setErrorText('');
      setDeletingFoodPlan({ weekStart, day });
      await deleteFoodPlan({ weekStart, day });
      const weekFoodPlan = await loadFoodPlan(weekStart);
      setFoodPlan(weekFoodPlan.items);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete food plan item');
    } finally {
      setDeletingFoodPlan(null);
    }
  }

  function openFoodPlanComposer(input: { weekStart: string; day: FoodPlanDay; item?: FoodPlanItem }) {
    setFoodPlanEditingKey(input.item ? `${input.item.weekStart}-${input.item.day}` : null);
    setFoodPlanDraft({
      weekStart: input.weekStart,
      day: input.day,
      dishName: input.item?.dishName ?? '',
      groceryInput: (input.item?.groceryList ?? []).join('\n'),
    });
    setFoodPlanComposerOpen(true);
  }

  function closeFoodPlanComposer() {
    setFoodPlanComposerOpen(false);
    setFoodPlanDraft(null);
    setFoodPlanEditingKey(null);
  }

  async function handleSaveFoodPlan() {
    if (!foodPlanDraft) {
      return;
    }

    const dishName = foodPlanDraft.dishName.trim();
    if (!dishName) {
      setErrorText('Dish name is required');
      return;
    }

    const groceryList = foodPlanDraft.groceryInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      setFoodPlanSaving(true);
      setErrorText('');
      await updateFoodPlan({
        weekStart: foodPlanDraft.weekStart,
        day: foodPlanDraft.day,
        dishName,
        groceryList,
      });
      const weekFoodPlan = await loadFoodPlan(foodPlanDraft.weekStart);
      setFoodPlan(weekFoodPlan.items);
      closeFoodPlanComposer();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save food plan item');
    } finally {
      setFoodPlanSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
      <div className="mx-auto flex w-full max-w-none flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              Planner overview
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">Agenda overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Always starts from today. {weatherForecast?.resolvedLocation ? `Weather: ${weatherForecast.resolvedLocation.name}${weatherForecast.resolvedLocation.admin1 ? `, ${weatherForecast.resolvedLocation.admin1}` : ''}${weatherForecast.resolvedLocation.country ? `, ${weatherForecast.resolvedLocation.country}` : ''}.` : weatherConfig.location ? 'Loading configured weather location...' : 'Set weather location in Settings to show live forecast.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 py-2 text-sm font-medium hover:bg-accent/60">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-border/60 bg-card/60">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              {errorText ? (
                <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {errorText}
                </div>
              ) : null}
              <div className="space-y-4">
                <div className="rounded-[30px] border border-border/60 bg-card/35 p-3">
                  <AgendaView
                    members={members}
                    entries={entries}
                    memberColorById={memberColorById}
                    dayWeatherByDate={dayWeatherByDate}
                  />
                </div>
              </div>
            </section>

            <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Food plan</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Current week from the backend food plan API.</p>
                </div>
                <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{foodPlan.length} meals</div>
              </div>
              <div className="space-y-2">
                {(() => {
                  const weekStart = getWeekStart();
                  const days: Array<{ key: string; label: string }> = [
                    { key: 'monday', label: 'Monday' },
                    { key: 'tuesday', label: 'Tuesday' },
                    { key: 'wednesday', label: 'Wednesday' },
                    { key: 'thursday', label: 'Thursday' },
                    { key: 'friday', label: 'Friday' },
                    { key: 'saturday', label: 'Saturday' },
                    { key: 'sunday', label: 'Sunday' },
                  ];

                  return days.map(({ key, label }) => {
                    const item = foodPlan.find((fp) => fp.day.toLowerCase() === key);

                    return (
                      <div key={key} className="rounded-2xl border border-border/60 bg-card/55 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                            <div className="mt-1 text-sm font-semibold">
                              {item?.dishName || <span className="text-muted-foreground">Not hungry?</span>}
                            </div>
                          </div>
                          {item ? (
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-muted-foreground">{item.groceryList.length} groceries</div>
                              <button
                                type="button"
                                onClick={() => openFoodPlanComposer({ weekStart: item.weekStart, day: item.day, item })}
                                className="rounded-lg border border-border/40 p-1.5 hover:bg-accent/60"
                                aria-label={`Edit ${item.dishName}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteFoodPlan(item.weekStart, item.day)}
                                disabled={deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day}
                                className="rounded-lg border border-border/40 p-1.5 hover:bg-destructive/10 disabled:opacity-60"
                                aria-label={`Delete ${item.dishName}`}
                              >
                                {deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => openFoodPlanComposer({ weekStart, day: key as FoodPlanDay })} className="rounded-lg border border-border/40 p-1.5 hover:bg-primary/10">
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {item && item.groceryList.length > 0 ? (
                          <div className="mt-2 text-xs text-muted-foreground">{item.groceryList.join(' · ')}</div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          </>
        )}
      </div>

      {foodPlanComposerOpen && foodPlanDraft ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-xl rounded-[32px] border border-border/60 bg-card/95 p-6 shadow-2xl shadow-black/30">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">{foodPlanEditingKey ? 'Edit dish' : 'Create dish'}</h2>
              <button type="button" onClick={closeFoodPlanComposer} aria-label="Close" className="rounded-xl border border-border/60 p-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveFoodPlan();
              }}
            >
              <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-xs text-muted-foreground uppercase tracking-[0.14em]">
                {foodPlanDraft.day} · week {foodPlanDraft.weekStart}
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Dish name</span>
                <input
                  value={foodPlanDraft.dishName}
                  onChange={(event) => setFoodPlanDraft((current) => (current ? { ...current, dishName: event.target.value } : current))}
                  className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  placeholder="Example: Chicken pasta bake"
                  required
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Groceries</span>
                <textarea
                  value={foodPlanDraft.groceryInput}
                  onChange={(event) => setFoodPlanDraft((current) => (current ? { ...current, groceryInput: event.target.value } : current))}
                  className="min-h-[110px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  placeholder="One item per line, or comma separated"
                />
              </label>
              <div className="flex items-center justify-between gap-2 pt-2">
                <div className="flex gap-2">
                  {foodPlanEditingKey ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleDeleteFoodPlan(foodPlanDraft.weekStart, foodPlanDraft.day);
                        closeFoodPlanComposer();
                      }}
                      disabled={deletingFoodPlan?.weekStart === foodPlanDraft.weekStart && deletingFoodPlan?.day === foodPlanDraft.day}
                      className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-60"
                    >
                      Delete dish
                    </button>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={foodPlanSaving}
                  className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
                >
                  {foodPlanSaving ? 'Saving...' : foodPlanEditingKey ? 'Update dish' : 'Save dish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
