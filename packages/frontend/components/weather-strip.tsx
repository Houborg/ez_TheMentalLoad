'use client';

import { cn } from '@/lib/utils';
import type { WeatherForecastResponse } from '@/lib/api';

type Props = {
  forecast: WeatherForecastResponse;
};

const DAYS_DA = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];

export function WeatherStrip({ forecast }: Props) {
  const todayDowIndex = new Date().getDay(); // 0=Sun

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex divide-x divide-border/50">
        {forecast.daily.slice(0, 7).map((day, i) => {
          const isToday = i === 0;
          const dowIndex = (todayDowIndex + i) % 7;
          return (
            <div
              key={day.date}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 px-1.5 py-3',
                isToday && 'bg-primary/10',
              )}
            >
              <span className={cn('text-[10px] font-bold uppercase tracking-wide', isToday ? 'text-primary' : 'text-muted-foreground')}>
                {DAYS_DA[dowIndex]}
              </span>
              <span className="text-2xl leading-none">{day.icon}</span>
              <span className={cn('text-[13px] font-bold', isToday ? 'text-primary' : 'text-foreground')}>
                {Math.round(day.tempMax)}°
              </span>
              <span className="text-[11px] text-muted-foreground">
                {Math.round(day.tempMin)}°
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
