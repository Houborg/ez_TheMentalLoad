'use client';

import { useEffect, useState } from 'react';
import { Menu, Plus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WeatherForecastResponse } from '@/lib/api';

export type KioskView = 'today' | 'week';

type Props = {
  view: KioskView;
  onViewChange: (v: KioskView) => void;
  weatherForecast: WeatherForecastResponse | null;
  onAdd: () => void;
  onAI: () => void;
  onExit: () => void;
};

export function KioskTopBar({ view, onViewChange, weatherForecast, onAdd, onAI, onExit }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-black/30 px-4 py-3 backdrop-blur">
      <span className="text-2xl font-black tabular-nums tracking-tight text-white/90">{timeStr}</span>
      <span className="text-sm text-white/40">{dateStr}</span>
      {weatherForecast && (
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60">
          <span>{weatherForecast.current.icon}</span>
          <span>{Math.round(weatherForecast.current.temperature)}°{weatherForecast.unit}</span>
          {weatherForecast.resolvedLocation?.name && (
            <span className="text-white/30">· {weatherForecast.resolvedLocation.name}</span>
          )}
        </div>
      )}
      <div className="flex-1" />
      {/* Today / Uge toggle */}
      <div className="flex rounded-full bg-white/8 p-0.5">
        {(['today', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              view === v ? 'bg-primary text-primary-foreground shadow' : 'text-white/50 hover:text-white/80',
            )}
          >
            {v === 'today' ? 'I dag' : 'Uge'}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAI}
        aria-label="Åbn AI-assistent"
        className="flex h-9 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/6 px-3 text-sm text-white/60 transition hover:text-white/90"
      >
        <Sparkles className="h-3.5 w-3.5" />
        AI
      </button>
      <button
        type="button"
        onClick={onAdd}
        aria-label="Tilføj begivenhed"
        className="flex h-9 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" />
        Tilføj
      </button>
      <button
        type="button"
        onClick={onExit}
        aria-label="Tilbage til menu"
        title="Tilbage til menu"
        className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/40 transition hover:text-white/80"
      >
        <Menu className="h-4 w-4" />
      </button>
    </div>
  );
}
