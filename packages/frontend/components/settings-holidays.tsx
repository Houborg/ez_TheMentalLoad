'use client';

import { useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import type { Calendar } from '@mental-load/contracts';
import { createEntry } from '@/lib/api';
import { cn } from '@/lib/utils';

type Holiday = {
  date: string;
  localName: string;
  name: string;
  global: boolean;
};

type Props = {
  calendars: Calendar[];
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR + 1];

export function SettingsHolidays({ calendars }: Props) {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [calendarId, setCalendarId] = useState(calendars[0]?.id ?? '');
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  async function fetchHolidays() {
    setLoading(true);
    setError(null);
    setFetched(false);
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/DK`);
      if (!res.ok) throw new Error('Kunne ikke hente helligdage');
      const data: Holiday[] = await res.json();
      // Filter to global/public holidays only
      const filtered = data.filter(h => h.global);
      setHolidays(filtered);
      setSelected(new Set(filtered.map(h => h.date)));
      setAdded(new Set());
      setFetched(true);
    } catch {
      setError('Fejl ved hentning af helligdage. Prøv igen.');
    } finally {
      setLoading(false);
    }
  }

  function toggleAll() {
    if (selected.size === holidays.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(holidays.map(h => h.date)));
    }
  }

  function toggle(date: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function addToCalendar() {
    if (!calendarId || selected.size === 0) return;
    setAdding(true);
    setError(null);
    const newlyAdded = new Set<string>();
    try {
      for (const holiday of holidays.filter(h => selected.has(h.date))) {
        const start = new Date(holiday.date);
        const end = new Date(holiday.date);
        end.setDate(end.getDate() + 1);
        await createEntry({
          title: holiday.localName,
          type: 'event',
          ownerMemberId: '',
          calendarId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          timezone: 'Europe/Copenhagen',
          allDay: true,
          location: undefined,
          recurrenceRule: undefined,
          assignedToMemberId: undefined,
        });
        newlyAdded.add(holiday.date);
      }
      setAdded(newlyAdded);
      setSelected(new Set());
    } catch {
      setError('Fejl ved tilføjelse af helligdage. Nogle kan allerede være tilføjet.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="grid gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">År</span>
          <select
            value={year}
            onChange={e => { setYear(Number(e.target.value)); setFetched(false); setHolidays([]); }}
            className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
          >
            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="grid gap-1 flex-1 min-w-[180px]">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kalender</span>
          <select
            value={calendarId}
            onChange={e => setCalendarId(e.target.value)}
            className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
          >
            {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={fetchHolidays}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Hent helligdage
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Holiday list */}
      {fetched && holidays.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-primary hover:underline"
            >
              {selected.size === holidays.length ? 'Fravælg alle' : 'Vælg alle'}
            </button>
            <span className="text-xs text-muted-foreground">{selected.size} valgt</span>
          </div>

          <div className="rounded-2xl border border-border/60 divide-y divide-border/40 overflow-hidden">
            {holidays.map(h => {
              const isAdded = added.has(h.date);
              const isSelected = selected.has(h.date);
              const dateLabel = new Date(h.date).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'long' });
              return (
                <button
                  key={h.date}
                  type="button"
                  onClick={() => !isAdded && toggle(h.date)}
                  disabled={isAdded}
                  className={cn(
                    'flex items-center gap-3 w-full px-4 py-3 text-left transition-colors',
                    isAdded ? 'opacity-50 cursor-default' : 'hover:bg-accent/40',
                  )}
                >
                  <div className={cn(
                    'h-4 w-4 flex-shrink-0 rounded border-2 flex items-center justify-center',
                    isAdded
                      ? 'bg-green-500 border-green-500'
                      : isSelected
                        ? 'bg-primary border-primary'
                        : 'border-muted-foreground',
                  )}>
                    {(isSelected || isAdded) && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{h.localName}</div>
                    <div className="text-xs text-muted-foreground">{dateLabel}</div>
                  </div>
                  {isAdded && <span className="text-xs text-green-500 font-medium">Tilføjet</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addToCalendar}
            disabled={adding || selected.size === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            {adding ? 'Tilføjer…' : `Tilføj ${selected.size} helligdag${selected.size !== 1 ? 'e' : ''} til kalender`}
          </button>
        </>
      )}

      {fetched && holidays.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground text-center py-4">Ingen helligdage fundet for {year}.</p>
      )}
    </div>
  );
}
