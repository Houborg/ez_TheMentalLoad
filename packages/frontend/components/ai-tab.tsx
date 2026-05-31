'use client';

import { useEffect, useState, useRef } from 'react';
import { Send, RefreshCw } from 'lucide-react';
import type { AiSuggestion, Member } from '@mental-load/contracts';
import { getAiSuggestions, dismissAiSuggestion, triggerAiAnalysis, askAssistant, createAiMemory } from '@/lib/api';
import { AiSuggestionCard } from '@/components/ai-suggestion-card';
import { AiConfirmationSheet } from '@/components/ai-confirmation-sheet';
import { AiKnowledgeMap } from '@/components/ai-knowledge-map';
import { cn } from '@/lib/utils';

const GROUP_LABELS = [
  { key: 'today', label: 'I dag' },
  { key: 'week', label: 'Denne uge' },
  { key: 'later', label: 'Senere' },
];

function groupSuggestions(suggestions: AiSuggestion[]): Record<string, AiSuggestion[]> {
  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);

  return {
    today: suggestions.filter(s => new Date(s.createdAt) <= todayEnd),
    week: suggestions.filter(s => {
      const d = new Date(s.createdAt);
      return d > todayEnd && d <= weekEnd;
    }),
    later: suggestions.filter(s => new Date(s.createdAt) > weekEnd),
  };
}

interface Props {
  members: Member[];
}

export function AiTab({ members }: Props) {
  const [view, setView] = useState<'suggestions' | 'brain'>('suggestions');
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<AiSuggestion | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    getAiSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, []);

  function handleAccept(s: AiSuggestion) {
    setConfirming(s);
  }

  function handleDismiss(id: string) {
    dismissAiSuggestion(id).catch(() => undefined);
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }

  function handleDismissPermanent(suggestion: AiSuggestion) {
    dismissAiSuggestion(suggestion.id).catch(() => undefined);
    setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
    // Save a memory so Claude never re-suggests this
    createAiMemory({
      category: 'preference',
      key: `ikke_relevant: ${suggestion.text.slice(0, 60)}`,
      value: 'brugeren markerede dette som ikke relevant — foreslå ikke igen',
    }).catch(() => undefined);
  }

  function handleDone(id: string) {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }

  async function handleChat() {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput('');
    // Show the message immediately as a "thinking" card
    const tempId = `chat-${Date.now()}`;
    setSuggestions(prev => [{
      id: tempId,
      triggerType: 'manual',
      category: 'info',
      text: `💬 ${msg}`,
      actionType: 'info',
      actionData: {},
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }, ...prev]);
    try {
      const res = await askAssistant({ message: msg });
      // Replace the temp card with the real response
      setSuggestions(prev => prev.map(s => s.id === tempId
        ? { ...s, text: res.response }
        : s,
      ));
    } catch {
      setSuggestions(prev => prev.filter(s => s.id !== tempId));
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      await triggerAiAnalysis();
      setTimeout(async () => {
        const fresh = await getAiSuggestions().catch(() => []);
        setSuggestions(fresh);
        setAnalyzing(false);
      }, 3000);
    } catch {
      setAnalyzing(false);
    }
  }

  const grouped = groupSuggestions(suggestions);
  const pendingCount = suggestions.length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">🤖 AI-assistent</span>
          {pendingCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing}
          className="text-muted-foreground hover:text-primary transition-colors"
          title="Kør analyse nu"
        >
          <RefreshCw className={cn('h-4 w-4', analyzing && 'animate-spin')} />
        </button>
      </div>

      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setView('suggestions')}
          className={cn('flex-1 py-2.5 text-xs font-bold transition-colors',
            view === 'suggestions' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground')}
        >
          Forslag {pendingCount > 0 ? `(${pendingCount})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setView('brain')}
          className={cn('flex-1 py-2.5 text-xs font-bold transition-colors',
            view === 'brain' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground')}
        >
          Familiehjernen 🧠
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {view === 'suggestions' ? (
          <div className="p-3 space-y-4">
            {loading && <p className="text-sm text-muted-foreground">Henter forslag…</p>}
            {!loading && suggestions.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🤖</div>
                <div className="text-sm font-medium text-muted-foreground">Ingen forslag lige nu</div>
                <div className="text-xs text-muted-foreground mt-1">Tryk ↺ for at analysere familiedata</div>
              </div>
            )}
            {GROUP_LABELS.map(({ key, label }) => {
              const items = grouped[key];
              if (!items?.length) return null;
              return (
                <div key={key}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
                  <div className="space-y-2">
                    {items.map(s => (
                      <AiSuggestionCard
                        key={s.id}
                        suggestion={s}
                        onAccept={handleAccept}
                        onDismiss={handleDismiss}
                        onDismissPermanent={handleDismissPermanent}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <AiKnowledgeMap members={members} />
        )}
      </div>

      {view === 'suggestions' && (
        <div className="border-t border-border bg-card px-3 pt-2 pb-3 flex flex-col gap-2">
          {/* Quick action chips */}
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => { setChatInput(''); void (async () => { const msg = 'Giv mig en morgenbriefing: hvad sker der i dag for familien, hvilke timer/klasser har børnene i dag, og hvad skal vi huske inden da?'; const saved = chatInput; setChatInput(''); const res = await askAssistant({ message: msg }).catch(() => null); if (res) { const tempId = crypto.randomUUID(); setSuggestions(prev => [{ id: tempId, triggerType: 'manual', category: 'info', text: res.response, actionType: 'info', actionData: {}, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }, ...prev]); } })(); }}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              ☀️ Morgenbriefing
            </button>
            <button
              type="button"
              onClick={() => setChatInput('Hvad mangler vi på indkøbslisten denne uge?')}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              🛒 Indkøb?
            </button>
            <button
              type="button"
              onClick={() => setChatInput('Hvornår er vi alle fri til noget fælles?')}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              📅 Ledig tid?
            </button>
          </div>
          {/* Chat input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleChat()}
              placeholder="Spørg AI om familien…"
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void handleChat()}
              disabled={!chatInput.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <AiConfirmationSheet
        suggestion={confirming}
        onClose={() => setConfirming(null)}
        onDone={handleDone}
      />
    </div>
  );
}
