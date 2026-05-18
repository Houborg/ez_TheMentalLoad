'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Edit2, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import type { Entry, FoodPlanDay, FoodPlanItem, Member } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { EntryDetailsPopup } from '@/components/entry-details-popup';
import { cn } from '@/lib/utils';
import { deduplicateRecurringTasks } from '@/lib/entry-utils';
import {
  deleteEntry,
  deleteFoodPlan,
  getWeekStart,
  loadDashboardSnapshot,
  loadFoodPlan,
  loadSettings,
  loadUpcomingOccurrences,
  loadWeatherForecast,
  updateEntry,
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

function getEntryMutationId(id: string): string {
  const sep = id.indexOf(':');
  return sep === -1 ? id : id.slice(0, sep);
}

type Props = {
  /** Pass members from dashboard if already loaded, otherwise fetches its own */
  members?: Member[];
  memberColorById?: Record<string, string>;
};

export function PlannerView({ members: membersProp, memberColorById: colorsProp }: Props) {
  const [members, setMembers] = useState<Member[]>(membersProp ?? []);
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
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    async function load() {
      try {
        const [snapshot, upcoming, weekFoodPlan] = await Promise.all([
          membersProp ? null : loadDashboardSnapshot(),
          loadUpcomingOccurrences(7),
          loadFoodPlan(getWeekStart()),
        ]);

        const settings = await loadSettings();
        const rawWeather = settings.sync.configJson.weather;
        const w = rawWeather as Record<string, unknown> | undefined;
        const resolvedWeather = {
          location: typeof w?.location === 'string' ? w.location : '',
          state: typeof w?.state === 'string' ? w.state : '',
          country: typeof w?.country === 'string' ? w.country : '',
          unit: w?.unit === 'F' ? 'F' as const : 'C' as const,
        };

        if (resolvedWeather.location) {
          const forecast = await loadWeatherForecast({
            location: resolvedWeather.location,
            state: resolvedWeather.state,
            country: resolvedWeather.country,
            unit: resolvedWeather.unit,
            days: 7,
          });
          if (active) setWeatherForecast(forecast);
        }

        if (!active) return;
        if (snapshot) setMembers(snapshot.members);
        setEntries(deduplicateRecurringTasks(upcoming));
        setWeatherConfig(resolvedWeather);
        setFoodPlan(weekFoodPlan.items);
      } catch (err) {
        if (active) setErrorText(err instanceof Error ? err.message : 'Could not load planner');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, []);

  const memberColorById = useMemo(() => {
    if (colorsProp) return colorsProp;
    return members.reduce<Record<string, string>>((acc, m, i) => {
      acc[m.id] = MEMBER_COLOR_CLASSES[i % MEMBER_COLOR_CLASSES.length];
      return acc;
    }, {});
  }, [members, colorsProp]);

  const dayWeatherByDate = useMemo(() => {
    if (!weatherForecast) return {} as Record<string, { temp: number; unitLabel: string; icon: string }>;
    return weatherForecast.daily.reduce<Record<string, { temp: number; unitLabel: string; icon: string }>>((acc, day) => {
      acc[day.date] = { temp: Math.round(day.tempMax), unitLabel: weatherForecast.unit, icon: day.icon };
      return acc;
    }, {});
  }, [weatherForecast]);

  async function handleDeleteFoodPlan(weekStart: string, day: FoodPlanDay) {
    setDeletingFoodPlan({ weekStart, day });
    try {
      await deleteFoodPlan({ weekStart, day });
      setFoodPlan((await loadFoodPlan(weekStart)).items);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Could not delete');
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
    if (!foodPlanDraft) return;
    const dishName = foodPlanDraft.dishName.trim();
    if (!dishName) { setErrorText('Dish name is required'); return; }
    const groceryList = foodPlanDraft.groceryInput.split(/\r?\n|,/).map(v => v.trim()).filter(Boolean);
    setFoodPlanSaving(true);
    try {
      await updateFoodPlan({ weekStart: foodPlanDraft.weekStart, day: foodPlanDraft.day, dishName, groceryList });
      setFoodPlan((await loadFoodPlan(foodPlanDraft.weekStart)).items);
      closeFoodPlanComposer();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setFoodPlanSaving(false);
    }
  }

  const effectiveMembers = membersProp ?? members;

  return (
    <div className="flex flex-col gap-5 px-4 py-6 md:px-8">
      {/* Header */}
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-primary" />
          Planner overview
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Agenda overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {weatherForecast?.resolvedLocation
            ? `Weather: ${weatherForecast.resolvedLocation.name}${weatherForecast.resolvedLocation.admin1 ? `, ${weatherForecast.resolvedLocation.admin1}` : ''}.`
            : weatherConfig.location
              ? 'Loading weather…'
              : 'Set weather location in Settings to show live forecast.'}
        </p>
      </div>

      {errorText && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {errorText}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[28px] border border-border/60 bg-card/60">
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Agenda */}
          <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
            <div className="rounded-[30px] border border-border/60 bg-card/35 p-3">
              <AgendaView
                members={effectiveMembers}
                entries={entries}
                memberColorById={memberColorById}
                dayWeatherByDate={dayWeatherByDate}
                onSelectEntry={setSelectedEntry}
              />
            </div>
          </section>

          {/* Food plan */}
          <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Food plan</h2>
                <p className="mt-1 text-sm text-muted-foreground">Current week.</p>
              </div>
              <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{foodPlan.length} meals</div>
            </div>
            <div className="space-y-2">
              {(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const).map((key) => {
                const label = { monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag', thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag' }[key];
                const item = foodPlan.find(fp => fp.day.toLowerCase() === key);
                const weekStart = getWeekStart();
                return (
                  <div key={key} className="rounded-2xl border border-border/60 bg-card/55 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                        <div className="mt-1 text-sm font-semibold">
                          {item?.dishName || <span className="text-muted-foreground">Intet planlagt</span>}
                        </div>
                      </div>
                      {item ? (
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-muted-foreground">{item.groceryList.length} varer</div>
                          <button
                            type="button"
                            onClick={() => openFoodPlanComposer({ weekStart: item.weekStart, day: item.day, item })}
                            className="rounded-lg border border-border/40 p-1.5 hover:bg-accent/60"
                            aria-label={`Rediger ${item.dishName}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteFoodPlan(item.weekStart, item.day)}
                            disabled={deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day}
                            className="rounded-lg border border-border/40 p-1.5 hover:bg-destructive/10 disabled:opacity-60"
                            aria-label={`Slet ${item.dishName}`}
                          >
                            {deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day
                              ? <LoaderCircle className="h-4 w-4 animate-spin" />
                              : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openFoodPlanComposer({ weekStart, day: key as FoodPlanDay })}
                          className="rounded-lg border border-border/40 p-1.5 hover:bg-primary/10"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {item && item.groceryList.length > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">{item.groceryList.join(' · ')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Food plan composer modal */}
      {foodPlanComposerOpen && foodPlanDraft && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-xl rounded-[32px] border border-border/60 bg-card/95 p-6 shadow-2xl shadow-black/30">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">{foodPlanEditingKey ? 'Rediger ret' : 'Tilføj ret'}</h2>
              <button type="button" onClick={closeFoodPlanComposer} aria-label="Luk" className="rounded-xl border border-border/60 p-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); void handleSaveFoodPlan(); }}>
              <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-xs text-muted-foreground uppercase tracking-[0.14em]">
                {foodPlanDraft.day} · uge {foodPlanDraft.weekStart}
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Retnavn</span>
                <input
                  value={foodPlanDraft.dishName}
                  onChange={e => setFoodPlanDraft(d => d ? { ...d, dishName: e.target.value } : d)}
                  className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  placeholder="Eks: Pasta med kødsauce"
                  required
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Indkøbsliste</span>
                <textarea
                  value={foodPlanDraft.groceryInput}
                  onChange={e => setFoodPlanDraft(d => d ? { ...d, groceryInput: e.target.value } : d)}
                  className="min-h-[110px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  placeholder="Én vare per linje"
                />
              </label>
              <div className="flex items-center justify-between gap-2 pt-2">
                <div>
                  {foodPlanEditingKey && (
                    <button
                      type="button"
                      onClick={() => { void handleDeleteFoodPlan(foodPlanDraft.weekStart, foodPlanDraft.day); closeFoodPlanComposer(); }}
                      className={cn('rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-60')}
                    >
                      Slet ret
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={foodPlanSaving}
                  className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
                >
                  {foodPlanSaving ? 'Gemmer…' : foodPlanEditingKey ? 'Opdater' : 'Gem'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Entry detail popup */}
      {selectedEntry && (
        <EntryDetailsPopup
          entry={selectedEntry}
          ownerName={effectiveMembers.find(m => m.id === selectedEntry.ownerMemberId)?.name}
          onClose={() => setSelectedEntry(null)}
          onSave={async patch => {
            await updateEntry(getEntryMutationId(selectedEntry.id), patch);
            setEntries(deduplicateRecurringTasks(await loadUpcomingOccurrences(7)));
          }}
          onDelete={async () => {
            await deleteEntry(getEntryMutationId(selectedEntry.id));
            setEntries(deduplicateRecurringTasks(await loadUpcomingOccurrences(7)));
            setSelectedEntry(null);
          }}
        />
      )}
    </div>
  );
}
