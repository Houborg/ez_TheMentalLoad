'use client';

import { useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry, Member, FoodPlanItem } from '@mental-load/contracts';
import { askAssistant } from '@/lib/api';
import { MealDetailSheet } from '@/components/meal-detail-sheet';

const QUICK_CHIPS = [
  'Hvornår er alle fri denne uge?',
  'Ledigt mandag?',
  'Find 2 timer til hele familien',
  'Hvornår kan vi spise aftensmad sammen?',
];

const WEEKDAYS: FoodPlanItem['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

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

/** Format the next 7 days of entries as a compact text block for the AI prompt */
function buildCalendarContext(entries: Entry[], members: Member[]): string {
  const memberById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const now = new Date();
  const limit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const relevant = entries.filter((e) => {
    const start = new Date(e.startTime);
    return start >= now && start <= limit;
  });
  if (relevant.length === 0) return 'Ingen aftaler de næste 7 dage.';
  return relevant
    .map((e) => {
      const start = new Date(e.startTime);
      const who = memberById[e.ownerMemberId] ?? 'Ukendt';
      const day = start.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'short' });
      const time = e.allDay ? 'hele dagen' : start.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      return `- ${day} ${time}: ${e.title} (${who})`;
    })
    .join('\n');
}

type Props = {
  members: Member[];
  entries: Entry[];
  foodPlanItems: FoodPlanItem[];
  onCreateEntry: () => void;
};

export function PlannerView({ members, entries, foodPlanItems, onCreateEntry }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<FoodPlanItem | null>(null);

  const todayDay = new Date()
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase() as FoodPlanItem['day'];

  async function handleAsk(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setAskedQuestion(q);
    setAnswer('');
    setQuestion('');
    try {
      const calendarContext = buildCalendarContext(entries, members);
      const memberNames = members.map((m) => m.name).join(', ');
      const prompt = `Familiemedlemmer: ${memberNames}\n\nKalender de næste 7 dage:\n${calendarContext}\n\nSpørgsmål: ${q}\n\nSvar på dansk. Vær konkret og hjælpsom. Find ledige tider og svar direkte.`;
      const result = await askAssistant({ message: prompt });
      setAnswer(result.response);
    } catch {
      setAnswer('Beklager, kunne ikke hente svar. Prøv igen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3">

      {/* AI input bar */}
      <div className="flex items-center gap-2 rounded-xl border-2 border-primary bg-card px-3 py-2 shadow-sm shadow-primary/10">
        <span className="text-lg" aria-hidden="true">🤖</span>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAsk(question); }}
          placeholder="Hvornår kan vi…"
          aria-label="Spørg om ledige tider"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => void handleAsk(question)}
          disabled={!question.trim() || busy}
          aria-label="Send"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Quick chips */}
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => void handleAsk(chip)}
            disabled={busy}
            className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* AI answer */}
      {(busy || answer) && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
            <span className="text-sm" aria-hidden="true">🤖</span>
            <span className="truncate text-[11px] font-bold text-foreground">{askedQuestion}</span>
          </div>
          <div className="px-3 py-3">
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="animate-spin text-primary" aria-hidden="true">⏳</span>
                <span>Tjekker kalenderen…</span>
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{answer}</p>
                <button
                  type="button"
                  onClick={onCreateEntry}
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tilføj til kalender
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
