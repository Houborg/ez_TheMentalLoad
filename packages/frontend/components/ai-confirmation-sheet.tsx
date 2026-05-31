'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Loader2, Send } from 'lucide-react';
import type { AiSuggestion } from '@mental-load/contracts';
import { confirmAiSuggestion, executeAiSuggestion, askAssistant } from '@/lib/api';

interface ChatMessage {
  role: 'ai' | 'user';
  text: string;
}

function buildInitialAiMessage(s: AiSuggestion): string {
  const d = s.actionData as Record<string, unknown>;
  switch (s.actionType) {
    case 'update_food': {
      const day = String(d.day ?? '');
      const dish = String(d.dishName ?? '');
      return dish
        ? `Jeg vil planlægge "${dish}" til ${day}. Er det OK, eller vil du ændre noget?`
        : `Jeg vil planlægge mad for ${day}. Hvad skal der stå på menuen?`;
    }
    case 'add_event': {
      const title = String(d.title ?? s.text);
      const date = d.startTime
        ? new Date(String(d.startTime)).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' })
        : '';
      return `Jeg vil tilføje begivenheden "${title}"${date ? ` den ${date}` : ''}. Vil du justere tidspunkt, deltagere eller andre detaljer?`;
    }
    case 'add_task': {
      const title = String(d.title ?? s.text);
      return `Jeg vil tilføje opgaven "${title}". Vil du ændre hvem der har ansvar, deadline eller andet?`;
    }
    case 'set_reminder': {
      const mins = Number(d.minutesBefore ?? 30);
      return `Jeg vil sætte en påmindelse ${mins} minutter før. Passer det, eller vil du have et andet tidspunkt?`;
    }
    case 'add_grocery': {
      const items = Array.isArray(d.items) ? (d.items as string[]).join(', ') : String(d.items ?? '');
      return `Jeg vil tilføje til indkøbslisten: ${items}. Er der noget du vil tilføje eller fjerne?`;
    }
    default:
      return `Forslaget er: "${s.text}". Hvad vil du gøre?`;
  }
}

interface Props {
  suggestion: AiSuggestion | null;
  onClose: () => void;
  onDone: (suggestionId: string) => void;
}

export function AiConfirmationSheet({ suggestion, onClose, onDone }: Props) {
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef<string | null>(null);

  // Seed the initial AI message when the sheet opens
  useEffect(() => {
    if (!suggestion) {
      setChat([]);
      initializedRef.current = null;
      return;
    }
    if (initializedRef.current === suggestion.id) return;
    initializedRef.current = suggestion.id;
    setChat([{ role: 'ai', text: buildInitialAiMessage(suggestion) }]);
    setError('');
  }, [suggestion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  if (!suggestion) return null;

  async function handleSend() {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    setChat(prev => [...prev, { role: 'user', text: msg }]);
    try {
      // Give the AI context: what suggestion we're discussing + the user's message
      const context = `[Forslag: "${suggestion!.text}" — type: ${suggestion!.actionType}]\n${msg}`;
      const res = await askAssistant({ message: context });
      setChat(prev => [...prev, { role: 'ai', text: res.response }]);
    } catch {
      setChat(prev => [...prev, { role: 'ai', text: 'Beklager, noget gik galt. Prøv igen.' }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function handleExecute() {
    if (!suggestion) return;
    setExecuting(true);
    setError('');
    try {
      await confirmAiSuggestion(suggestion.id);
      const result = await executeAiSuggestion(suggestion.id);
      if (!result.ok) {
        setError(result.message);
        setExecuting(false);
        return;
      }
      onDone(suggestion.id);
      onClose();
    } catch {
      setError('Noget gik galt. Prøv igen.');
      setExecuting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-card border-t border-border shadow-2xl flex flex-col"
        style={{ maxHeight: '80dvh' }}>
        {/* Handle + header */}
        <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted" />
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              🤖 AI-assistent
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-sm font-semibold text-foreground leading-snug">{suggestion.text}</p>
        </div>

        {/* Chat thread */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {chat.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm'
              }`}>
                {msg.role === 'ai' && <span className="mr-1">🤖</span>}
                {msg.text}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 rounded-xl bg-destructive/10 text-destructive text-sm px-3 py-2 shrink-0">
            {error}
          </div>
        )}

        {/* Chat input */}
        <div className="px-3 py-2 border-t border-border flex items-center gap-2 shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleSend()}
            placeholder="Svar til AI…"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {/* Execute button */}
        <div className="px-4 pb-6 pt-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleExecute()}
            disabled={executing}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {executing && <Loader2 className="h-4 w-4 animate-spin" />}
            {executing ? 'Udfører…' : '✓ Udfør nu'}
          </button>
        </div>
      </div>
    </>
  );
}
