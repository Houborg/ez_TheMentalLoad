'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { AiSuggestion } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

const CATEGORY_COLORS: Record<AiSuggestion['category'], string> = {
  task: 'bg-violet-50 border-violet-200',
  food: 'bg-amber-50 border-amber-200',
  calendar: 'bg-blue-50 border-blue-200',
  grocery: 'bg-green-50 border-green-200',
  info: 'bg-gray-50 border-gray-200',
};

const CATEGORY_ICONS: Record<AiSuggestion['category'], string> = {
  task: '📋',
  food: '🍽️',
  calendar: '📅',
  grocery: '🛒',
  info: '💡',
};

interface Props {
  suggestion: AiSuggestion;
  onAccept: (suggestion: AiSuggestion) => void;
  onDismiss: (id: string) => void;
}

export function AiSuggestionCard({ suggestion, onAccept, onDismiss }: Props) {
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
        <Check className="h-4 w-4 text-green-600" />
        <span className="text-sm font-medium text-green-700">Tilføjet!</span>
      </div>
    );
  }

  const actionLabel = {
    add_event: 'Tilføj begivenhed',
    add_task: 'Tilføj opgave',
    update_food: 'Opdater madplan',
    add_grocery: 'Tilføj indkøb',
    set_reminder: 'Sæt påmindelse',
    info: 'OK',
  }[suggestion.actionType];

  return (
    <div className={cn('rounded-xl border px-4 py-3', CATEGORY_COLORS[suggestion.category])}>
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">{CATEGORY_ICONS[suggestion.category]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{suggestion.text}</p>
        </div>
        <button
          type="button"
          onClick={() => { setDismissed(true); onDismiss(suggestion.id); }}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Afvis forslag"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {suggestion.actionType !== 'info' && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => { setDone(true); onAccept(suggestion); }}
            className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
