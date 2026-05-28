'use client';

import { X } from 'lucide-react';
import type { FoodPlanItem } from '@mental-load/contracts';

const DAY_LABELS: Record<string, string> = {
  monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag',
  thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
};

const FOOD_EMOJI: Record<string, string> = {
  pasta: '🍝', pizza: '🍕', burger: '🍔', kylling: '🍗', laks: '🐟',
  fisk: '🐟', suppe: '🍲', salat: '🥗', tacos: '🌮', grillret: '🥩',
  ris: '🍚', kartofler: '🥔', spaghetti: '🍝', bøf: '🥩', kød: '🥩',
};

function getFoodEmoji(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(FOOD_EMOJI)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽';
}

type Props = {
  item: FoodPlanItem | null;
  onClose: () => void;
};

export function MealDetailSheet({ item, onClose }: Props) {
  if (!item) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Madplan: ${item.dishName}`}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-card border-t border-border shadow-2xl p-5 max-h-[80vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl" aria-hidden="true">{getFoodEmoji(item.dishName)}</span>
          <div className="flex-1">
            <div className="font-black text-base text-foreground">{item.dishName}</div>
            <div className="text-xs text-muted-foreground">{DAY_LABELS[item.day] ?? item.day}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Grocery list */}
        {item.groceryList.length > 0 ? (
          <>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Indkøbsliste
            </div>
            <div className="flex flex-col gap-1">
              {item.groceryList.map((ingredient, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm text-foreground"
                >
                  <span aria-hidden="true">🛒</span>
                  <span>{ingredient}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ingen indkøbsliste endnu. Rediger måltidsplanen for at tilføje ingredienser.
          </p>
        )}
      </div>
    </>
  );
}
