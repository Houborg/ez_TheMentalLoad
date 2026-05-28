'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { Entry, Member, FoodPlanItem } from '@mental-load/contracts';
import type { WeatherDailyPoint } from '@/lib/api';
import { TimeGrid } from '@/components/time-grid';
import { WeekGrid } from '@/components/week-grid';
import { MealDetailSheet } from '@/components/meal-detail-sheet';

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
};

export function IDagView({ members, entries, memberColorById, foodPlanItems, weatherByDate }: Props) {
  const [view, setView] = useState<'today' | 'week'>('today');
  const [selectedMeal, setSelectedMeal] = useState<FoodPlanItem | null>(null);

  const todayDay = new Date()
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase() as FoodPlanItem['day'];

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* Today / Uge toggle */}
      <div className="flex w-fit overflow-hidden rounded-lg border border-border">
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

      {/* Member avatar column headers */}
      <div className="flex overflow-hidden rounded-xl border border-border bg-card">
        <div className="w-8 shrink-0" />{/* gutter spacer to align with grid time labels */}
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
            entries={entries}
            memberColorById={memberColorById}
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

      {/* Meal strip */}
      <div>
        <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          🍽 Madplan denne uge
        </div>
        <div className="flex gap-2">
          {WEEKDAYS.map((day) => {
            const item = foodPlanItems.find((f) => f.day === day);
            const isToday = day === todayDay;
            return (
              <button
                key={day}
                type="button"
                onClick={() => { if (item) setSelectedMeal(item); }}
                disabled={!item}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-2 transition-all',
                  isToday
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card hover:border-primary/50',
                  !item && 'cursor-default opacity-50',
                )}
              >
                <span className={cn('text-[8px] font-bold', isToday ? 'text-primary' : 'text-muted-foreground')}>
                  {DAY_LABELS_SHORT[day]}{isToday ? ' ●' : ''}
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
    </div>
  );
}
