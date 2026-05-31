'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';
import { loadFoodPlan, updateFoodPlan, deleteFoodPlan } from '@/lib/api';
import { GroceryList } from '@/components/grocery-list';
import { MONTHS_DA } from '@/lib/calendar-utils';
import { BottomSheet } from './bottom-sheet';

const DAYS_DA_FULL = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const FOOD_PLAN_DAYS: FoodPlanDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function toWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

type Tab = 'madplan' | 'indkøb';

export function MobileFoodPlanner() {
  const [tab, setTab] = useState<Tab>('madplan');
  const [weekStart, setWeekStart] = useState(() => toWeekStart(new Date()));
  const [items, setItems] = useState<FoodPlanItem[]>([]);
  const [editDay, setEditDay] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFoodPlan(weekStart).then(r => setItems(r.items)).catch(console.error);
  }, [weekStart]);

  const weekStartDate = new Date(weekStart + 'T00:00:00Z');
  const weekEndDate = addDays(weekStartDate, 6);
  const weekLabel = `${weekStartDate.getUTCDate()}. ${MONTHS_DA[weekStartDate.getUTCMonth()]} – ${weekEndDate.getUTCDate()}. ${MONTHS_DA[weekEndDate.getUTCMonth()]}`;

  function prevWeek() {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function nextWeek() {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function itemForDay(dayIndex: number): FoodPlanItem | undefined {
    return items.find(i => i.day === FOOD_PLAN_DAYS[dayIndex]);
  }

  function openEdit(dayIndex: number) {
    const item = itemForDay(dayIndex);
    setEditDay(dayIndex);
    setEditText(item?.dishName ?? '');
  }

  async function saveEdit() {
    if (editDay === null) return;
    const day = FOOD_PLAN_DAYS[editDay];
    setSaving(true);
    try {
      if (editText.trim()) {
        await updateFoodPlan({ weekStart, day, dishName: editText.trim() });
        setItems(prev => {
          const filtered = prev.filter(i => i.day !== day);
          const existing = prev.find(i => i.day === day);
          const now = new Date().toISOString();
          const newItem: FoodPlanItem = {
            id: existing?.id ?? '',
            weekStart,
            day,
            dishName: editText.trim(),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          return [...filtered, newItem];
        });
      }
      setEditDay(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (editDay === null) return;
    const day = FOOD_PLAN_DAYS[editDay];
    setSaving(true);
    try {
      await deleteFoodPlan({ weekStart, day });
      setItems(prev => prev.filter(i => i.day !== day));
      setEditDay(null);
    } finally {
      setSaving(false);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <h1 className="text-lg font-bold">Mad</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevWeek}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
            aria-label="Forrige uge"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground px-1">{weekLabel}</span>
          <button
            type="button"
            onClick={nextWeek}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
            aria-label="Næste uge"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border mx-4 mt-3">
        <button
          type="button"
          onClick={() => setTab('madplan')}
          className={`flex-1 pb-2 text-sm font-semibold transition-colors ${
            tab === 'madplan'
              ? 'border-b-2 border-primary text-primary -mb-px'
              : 'text-muted-foreground'
          }`}
        >
          Madplan
        </button>
        <button
          type="button"
          onClick={() => setTab('indkøb')}
          className={`flex-1 pb-2 text-sm font-semibold transition-colors ${
            tab === 'indkøb'
              ? 'border-b-2 border-primary text-primary -mb-px'
              : 'text-muted-foreground'
          }`}
        >
          🛒 Indkøb
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'madplan' && (
          <div className="pb-20 px-4 flex flex-col gap-2 mt-3">
            {DAYS_DA_FULL.map((dayName, i) => {
              const item = itemForDay(i);
              const date = addDays(weekStartDate, i);
              const dateStr = date.toISOString().slice(0, 10);
              const isToday = dateStr === todayStr;
              return (
                <button
                  key={FOOD_PLAN_DAYS[i]}
                  type="button"
                  onClick={() => openEdit(i)}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-left w-full"
                >
                  <div>
                    <div className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                      {dayName}
                      {isToday && <span className="ml-2 text-xs font-normal">i dag</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {date.getUTCDate()}. {MONTHS_DA[date.getUTCMonth()]}
                    </div>
                  </div>
                  <div className="text-sm text-right max-w-[55%]">
                    {item
                      ? <div className="truncate">{item.dishName}</div>
                      : <span className="text-muted-foreground/50">Ingen plan</span>
                    }
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {tab === 'indkøb' && (
          <GroceryList weekStart={weekStart} />
        )}
      </div>

      {/* Edit bottom sheet (Madplan only) */}
      <BottomSheet
        open={editDay !== null}
        onClose={() => setEditDay(null)}
        ariaLabelledby="food-edit-title"
      >
        <div className="px-4 pb-8 pt-2">
          <h2 id="food-edit-title" className="font-semibold mb-3">
            {editDay !== null ? DAYS_DA_FULL[editDay] : ''}
          </h2>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void saveEdit()}
            placeholder="Hvad skal vi spise?"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Gemmer…' : 'Gem'}
            </button>
            {editDay !== null && itemForDay(editDay) && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="flex items-center gap-1 rounded-xl border border-border px-4 py-3 text-sm text-destructive disabled:opacity-50"
              >
                <X className="h-4 w-4" /> Slet
              </button>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
