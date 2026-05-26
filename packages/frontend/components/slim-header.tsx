'use client';

import { useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import type { WeatherForecastResponse } from '@/lib/api';

type Props = {
  weatherForecast: WeatherForecastResponse | null;
  onAdd: () => void;
  onAI: () => void;
};

export function SlimHeader({ weatherForecast, onAdd, onAI }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const timeStr = now.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-card/40 px-4 backdrop-blur md:px-6">
      <span className="text-base font-bold tabular-nums tracking-tight">{timeStr}</span>
      <span className="text-xs text-muted-foreground">{dateStr}</span>
      {weatherForecast && (
        <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-xs text-muted-foreground">
          <span>{weatherForecast.current.icon}</span>
          <span>{Math.round(weatherForecast.current.temperature)}°{weatherForecast.unit}</span>
        </div>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onAI}
        className="flex h-9 items-center gap-1.5 rounded-2xl border border-border/60 bg-background/60 px-3 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">AI</span>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="flex h-9 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Tilføj</span>
      </button>
    </header>
  );
}
