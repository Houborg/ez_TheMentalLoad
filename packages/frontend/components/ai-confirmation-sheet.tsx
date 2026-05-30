'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { AiSuggestion } from '@mental-load/contracts';
import { confirmAiSuggestion, executeAiSuggestion } from '@/lib/api';

interface Props {
  suggestion: AiSuggestion | null;
  onClose: () => void;
  onDone: (suggestionId: string) => void;
}

function describeAction(s: AiSuggestion): { title: string; details: string[] } {
  const d = s.actionData as Record<string, unknown>;
  switch (s.actionType) {
    case 'add_task':
      return {
        title: '📋 Ny opgave',
        details: [
          `Titel: ${String(d.title ?? '(ukendt)')}`,
          d.memberId ? `Ansvarlig: (udpeget)` : '',
        ].filter(Boolean),
      };
    case 'add_event':
      return {
        title: '📅 Ny begivenhed',
        details: [
          `Titel: ${String(d.title ?? '(ukendt)')}`,
          d.startTime ? `Dato: ${new Date(String(d.startTime)).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })}` : '',
        ].filter(Boolean),
      };
    case 'update_food':
      return {
        title: '🍽️ Opdater madplan',
        details: [
          `Dag: ${String(d.day ?? '(ukendt)')}`,
          `Ret: ${String(d.dishName ?? '(ukendt)')}`,
          Array.isArray(d.groceryList) && d.groceryList.length > 0
            ? `Indkøb: ${(d.groceryList as string[]).join(', ')}`
            : '',
        ].filter(Boolean),
      };
    case 'add_grocery':
      return {
        title: '🛒 Tilføj indkøb',
        details: Array.isArray(d.items) ? [`Varer: ${(d.items as string[]).join(', ')}`] : [],
      };
    case 'set_reminder':
      return {
        title: '⏰ Sæt påmindelse',
        details: [`${String(d.minutesBefore ?? 30)} minutter før`],
      };
    default:
      return { title: s.text, details: [] };
  }
}

export function AiConfirmationSheet({ suggestion, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!suggestion) return null;

  const { title, details } = describeAction(suggestion);

  async function handleConfirm() {
    if (!suggestion) return;
    setLoading(true);
    setError('');
    try {
      await confirmAiSuggestion(suggestion.id);
      const result = await executeAiSuggestion(suggestion.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone(suggestion.id);
      onClose();
    } catch {
      setError('Noget gik galt. Prøv igen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-card border-t border-border shadow-2xl p-5 pb-8">
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-muted" />

        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI vil tilføje</div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl bg-muted/40 px-4 py-3 mb-5">
          <div className="font-bold text-sm mb-2">{title}</div>
          {details.map((d, i) => (
            <div key={i} className="text-sm text-muted-foreground">{d}</div>
          ))}
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 text-destructive text-sm px-4 py-2 mb-3">{error}</div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-muted-foreground"
          >
            Annuller
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-[2] rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Tilføjer…' : 'Ja, tilføj'}
          </button>
        </div>
      </div>
    </>
  );
}
