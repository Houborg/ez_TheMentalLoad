'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, LoaderCircle } from 'lucide-react';
import type { Entry, Member } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { loadDashboardSnapshot, loadSettings, loadUpcomingOccurrences, loadWeatherForecast, type WeatherForecastResponse } from '@/lib/api';

const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

export default function PlannerPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [weatherConfig, setWeatherConfig] = useState({ location: '', state: '', country: '', unit: 'C' as 'C' | 'F' });

  useEffect(() => {
    let active = true;

    async function loadPlanner() {
      try {
        setErrorText('');
        const [snapshot, upcoming] = await Promise.all([
          loadDashboardSnapshot(),
          loadUpcomingOccurrences(7),
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
        )}
      </div>
    </div>
  );
}
