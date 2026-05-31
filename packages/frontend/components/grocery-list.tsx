'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { GroceryItem } from '@mental-load/contracts';
import {
  loadGroceryList,
  createGroceryItem,
  updateGroceryItem,
  deleteGroceryItem,
  clearCompletedGroceries,
} from '@/lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  kød: '🥩 Kød',
  mejeri: '🥛 Mejeri',
  grønt: '🥦 Grønt',
  tørvarer: '🧂 Tørvarer',
  andet: '🛒 Andet',
};

const CATEGORY_ORDER = ['kød', 'mejeri', 'grønt', 'tørvarer', 'andet'];

interface Props {
  weekStart: string;
}

export function GroceryList({ weekStart }: Props) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [addText, setAddText] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);

  useEffect(() => {
    loadGroceryList(weekStart).then(r => setItems(r.items)).catch(console.error);
  }, [weekStart]);

  const active = items.filter(i => !i.completed);
  const done = items.filter(i => i.completed);

  const grouped = CATEGORY_ORDER.reduce<Record<string, GroceryItem[]>>((acc, cat) => {
    const catItems = active.filter(i => i.category === cat);
    if (catItems.length > 0) acc[cat] = catItems;
    return acc;
  }, {});

  async function handleTick(item: GroceryItem) {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i));
    try {
      await updateGroceryItem(item.id, { completed: !item.completed });
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, completed: item.completed } : i));
    }
  }

  async function handleDelete(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    await deleteGroceryItem(id).catch(console.error);
  }

  async function handleAdd() {
    const text = addText.trim();
    if (!text) return;
    setAdding(true);
    setAddText('');
    try {
      const created = await createGroceryItem({ text, weekStart });
      setItems(prev => [...prev, created]);
    } finally {
      setAdding(false);
    }
  }

  async function handleClearDone() {
    setItems(prev => prev.filter(i => !i.completed));
    await clearCompletedGroceries(weekStart).catch(console.error);
  }

  return (
    <div className="flex flex-col gap-1 pb-24 pt-2">
      {/* Active items grouped by category */}
      {Object.entries(grouped).map(([cat, catItems]) => (
        <div key={cat}>
          <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {CATEGORY_LABELS[cat]}
          </div>
          {catItems.map(item => (
            <GroceryRow key={item.id} item={item} onTick={handleTick} onDelete={handleDelete} />
          ))}
        </div>
      ))}

      {active.length === 0 && done.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50 text-sm">
          <span className="text-3xl mb-3">🛒</span>
          <p>Ingen varer på listen</p>
          <p className="text-xs mt-1">Tilføj varer manuelt nedenfor</p>
        </div>
      )}

      {/* Add item */}
      <div className="px-4 mt-2">
        {showAddInput ? (
          <div className="flex gap-2 items-center">
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={addText}
              onChange={e => setAddText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleAdd();
                if (e.key === 'Escape') setShowAddInput(false);
              }}
              placeholder="Tilføj vare…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              disabled={adding}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={adding || !addText.trim()}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {adding ? '…' : 'Tilføj'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddInput(true)}
            className="flex items-center gap-2 w-full rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-4 w-4" />
            Tilføj vare…
          </button>
        )}
      </div>

      {/* I kurven section */}
      {done.length > 0 && (
        <div className="mx-4 mt-4 rounded-xl border border-border/40 bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              ✓ I kurven ({done.length})
            </span>
            <button
              type="button"
              onClick={() => void handleClearDone()}
              className="flex items-center gap-1 text-xs text-destructive font-semibold"
            >
              <Trash2 className="h-3 w-3" />
              Ryd alle
            </button>
          </div>
          {done.map(item => (
            <div key={item.id} className="flex items-center gap-3 py-2 border-t border-border/30">
              <button
                type="button"
                onClick={() => void handleTick(item)}
                className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
              >
                <span className="text-primary-foreground text-[10px]">✓</span>
              </button>
              <span className="text-sm line-through text-muted-foreground/60 flex-1">{item.text}</span>
              <button
                type="button"
                onClick={() => void handleDelete(item.id)}
                className="text-muted-foreground/30 hover:text-destructive transition-colors p-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  item: GroceryItem;
  onTick: (item: GroceryItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function GroceryRow({ item, onTick, onDelete }: RowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-0">
      <button
        type="button"
        onClick={() => void onTick(item)}
        className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0 hover:border-primary transition-colors"
        aria-label={`Marker ${item.text}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{item.text}</div>
        {item.source === 'manual' && (
          <div className="text-[10px] text-muted-foreground/50">Ekstra</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onDelete(item.id)}
        className="text-muted-foreground/30 hover:text-destructive transition-colors p-1"
        aria-label={`Slet ${item.text}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
