'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { FoodPlanDay, FoodPlanItem } from '@mental-load/contracts';
import { loadFoodPlan, updateFoodPlan, deleteFoodPlan } from '@/lib/api';
import { MONTHS_DA } from '@/lib/calendar-utils';
import { BottomSheet } from './bottom-sheet';

const DAYS_DA_FULL = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

const FOOD_PLAN_DAYS: FoodPlanDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

// Helper: get ISO date string for Monday of the week containing `date`
function toWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Helper: add N days to a UTC date
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function MobileFoodPlanner() {
  const [weekStart, setWeekStart] = useState(() => toWeekStart(new Date()));
  const [items, setItems] = useState<FoodPlanItem[]>([]);
  const [editDay, setEditDay] = useState<number | null>(null); // 0=Mon … 6=Sun
  const [editText, setEditText] = useState('');
  const [editGroceries, setEditGroceries] = useState(''); // newline-separated grocery items
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
    setEditGroceries((item?.groceryList ?? []).join('\n'));
  }

  async function saveEdit() {
    if (editDay === null) return;
    const day = FOOD_PLAN_DAYS[editDay];
    setSaving(true);
    try {
      if (editText.trim()) {
        const groceryList = editGroceries.split('\n').map(s => s.trim()).filter(Boolean);
        await updateFoodPlan({ weekStart, day, dishName: editText.trim(), groceryList });
        setItems(prev => {
          const filtered = prev.filter(i => i.day !== day);
          const existing = prev.find(i => i.day === day);
          const now = new Date().toISOString();
          const newItem: FoodPlanItem = {
            id: existing?.id ?? '',
            weekStart,
            day,
            dishName: editText.trim(),
            groceryList,
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
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <h1 className="text-lg font-bold">Madplan</h1>
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

      {/* Day cards */}
      <div className="flex-1 overflow-y-auto pb-20 px-4 flex flex-col gap-2">
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
                {item ? (
                  <div>
                    <div className="truncate">{item.dishName}</div>
                    {item.groceryList.length > 0 && (
                      <div className="text-xs text-muted-foreground">{item.groceryList.length} varer</div>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground/50">Ingen plan</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Edit bottom sheet */}
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
            autoFocus
            value={editText}
            onChange={e => setEditText(e.target.value)}
            placeholder="Hvad skal vi spise?"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
          />
          <label className="block text-xs text-muted-foreground mb-1">Indkøbsliste (én vare pr. linje)</label>
          <textarea
            value={editGroceries}
            onChange={e => setEditGroceries(e.target.value)}
            placeholder={"Mælk\nÆg\nBrød"}
            rows={4}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary mb-3 resize-none"
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
