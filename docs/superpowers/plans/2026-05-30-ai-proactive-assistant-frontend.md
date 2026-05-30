# AI Proactive Assistant — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full AI frontend: dedicated AI tab (suggestion feed + Familiehjernen knowledge map + chat), inline contextual chips on events and food plan, member fact chips in Familie view, and a Settings → AI editor.

**Architecture:** New AI tab added to BottomNav. `AiTab` component toggles between suggestion feed and knowledge map. `AiSuggestionCard` uses chip-style visuals (Option B aesthetics). `AiConfirmationSheet` gates every action. Inline chips added to `EntryDetailsPopup` and `IDagView`. `AiKnowledgeMap` renders a visual family brain with expandable member bubbles.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, TypeScript. No new dependencies.

**Prerequisites:** Backend plan (`2026-05-30-ai-proactive-assistant-backend.md`) must be deployed first.

---

## File Map

| File | Change |
|---|---|
| `packages/frontend/lib/api.ts` | Add AI API wrappers |
| `packages/frontend/components/ai-suggestion-card.tsx` | Create |
| `packages/frontend/components/ai-confirmation-sheet.tsx` | Create |
| `packages/frontend/components/ai-knowledge-map.tsx` | Create |
| `packages/frontend/components/ai-tab.tsx` | Create |
| `packages/frontend/components/bottom-nav.tsx` | Add AI nav item |
| `packages/frontend/components/dashboard-app.tsx` | Wire AI tab |
| `packages/frontend/components/entry-details-popup.tsx` | Add inline AI chips |
| `packages/frontend/components/idag-view.tsx` | Add food-plan AI chips |
| `packages/frontend/components/familie-view.tsx` | Add member fact chips |
| `packages/frontend/components/mobile/mobile-settings-content.tsx` | Add AI editor tab |

---

## Task 1: API wrappers in lib/api.ts

**Files:**
- Modify: `packages/frontend/lib/api.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/frontend/lib/api.ts`, ensure `AiSuggestion` and `AiMemory` are imported from `@mental-load/contracts`.

- [ ] **Step 2: Add AI fetch wrappers**

After the existing schedule/confirmation wrappers, add:

```typescript
// ── AI ────────────────────────────────────────────────────────────────────────

export async function getAiSuggestions(): Promise<AiSuggestion[]> {
  return apiFetch<AiSuggestion[]>('/api/v1/ai/suggestions');
}

export async function confirmAiSuggestion(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/ai/suggestions/${id}/confirm`, { method: 'POST' });
}

export async function executeAiSuggestion(id: string): Promise<{ ok: boolean; message: string; createdId?: string }> {
  return apiFetch<{ ok: boolean; message: string; createdId?: string }>(`/api/v1/ai/suggestions/${id}/execute`, { method: 'POST' });
}

export async function dismissAiSuggestion(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/ai/suggestions/${id}`, { method: 'DELETE' });
}

export async function getAiMemory(): Promise<AiMemory[]> {
  return apiFetch<AiMemory[]>('/api/v1/ai/memory');
}

export async function createAiMemory(input: { memberId?: string; category: AiMemory['category']; key: string; value: string }): Promise<AiMemory> {
  return apiFetch<AiMemory>('/api/v1/ai/memory', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteAiMemory(id: string): Promise<void> {
  await apiFetch<void>(`/api/v1/ai/memory/${id}`, { method: 'DELETE' });
}

export async function triggerAiAnalysis(): Promise<void> {
  await apiFetch<void>('/api/v1/ai/analyze', { method: 'POST' });
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/lib/api.ts
git commit -m "feat(frontend): AI API wrappers"
```

---

## Task 2: AiSuggestionCard component

**Files:**
- Create: `packages/frontend/components/ai-suggestion-card.tsx`

- [ ] **Step 1: Create the component**

`packages/frontend/components/ai-suggestion-card.tsx`:
```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/ai-suggestion-card.tsx
git commit -m "feat(frontend): AiSuggestionCard component"
```

---

## Task 3: AiConfirmationSheet component

**Files:**
- Create: `packages/frontend/components/ai-confirmation-sheet.tsx`

- [ ] **Step 1: Create the component**

`packages/frontend/components/ai-confirmation-sheet.tsx`:
```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/ai-confirmation-sheet.tsx
git commit -m "feat(frontend): AiConfirmationSheet bottom sheet"
```

---

## Task 4: AiKnowledgeMap component

**Files:**
- Create: `packages/frontend/components/ai-knowledge-map.tsx`

- [ ] **Step 1: Create the component**

`packages/frontend/components/ai-knowledge-map.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Bot, Pencil } from 'lucide-react';
import type { AiMemory, Member } from '@mental-load/contracts';
import { getAiMemory, createAiMemory, deleteAiMemory } from '@/lib/api';

const CATEGORY_LABELS: Record<AiMemory['category'], string> = {
  person: '👤 Person',
  preference: '❤️ Præference',
  pattern: '🔄 Mønster',
  event: '📅 Begivenhed',
};

interface Props {
  members: Member[];
  filterMemberId?: string; // if set, only show facts for this member
}

export function AiKnowledgeMap({ members, filterMemberId }: Props) {
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(filterMemberId ?? null);
  const [addingFor, setAddingFor] = useState<string | null>(null); // member id or 'family'
  const [form, setForm] = useState({ category: 'preference' as AiMemory['category'], key: '', value: '' });

  useEffect(() => {
    setLoading(true);
    getAiMemory()
      .then(setMemories)
      .catch(() => setMemories([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd() {
    if (!form.key.trim() || !form.value.trim()) return;
    const memberId = addingFor === 'family' ? undefined : (addingFor ?? undefined);
    const created = await createAiMemory({ memberId, ...form });
    setMemories(prev => [...prev, created]);
    setAddingFor(null);
    setForm({ category: 'preference', key: '', value: '' });
  }

  async function handleDelete(id: string) {
    await deleteAiMemory(id);
    setMemories(prev => prev.filter(m => m.id !== id));
  }

  const memberGroups = [...members, { id: 'family', name: 'Familie', role: 'parent' as const }];
  const displayMembers = filterMemberId
    ? memberGroups.filter(m => m.id === filterMemberId)
    : memberGroups;

  if (loading) return <p className="text-sm text-muted-foreground p-4">Henter…</p>;

  return (
    <div className="space-y-3 p-3">
      {displayMembers.map(member => {
        const memberMemories = memories.filter(m =>
          member.id === 'family' ? !m.memberId : m.memberId === member.id,
        );
        const isExpanded = expandedMemberId === member.id;

        return (
          <div key={member.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
              onClick={() => setExpandedMemberId(isExpanded ? null : member.id)}
            >
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold shrink-0">
                {member.id === 'family' ? '🏠' : (member as Member).avatar ?? member.name.slice(0, 1).toUpperCase()}
              </div>
              <span className="flex-1 text-left font-semibold text-sm">{member.name}</span>
              <span className="text-xs text-muted-foreground">{memberMemories.length} facts</span>
            </button>

            {isExpanded && (
              <div className="border-t border-border/50 px-4 py-3 space-y-2">
                {memberMemories.length === 0 && (
                  <p className="text-xs text-muted-foreground">Ingen facts endnu. Tilføj noget AI bør vide.</p>
                )}
                {memberMemories.map(mem => (
                  <div key={mem.id} className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-xs mt-0.5">
                      {mem.source === 'ai' ? <Bot className="h-3 w-3 text-primary" /> : <Pencil className="h-3 w-3 text-muted-foreground" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-semibold text-foreground">{mem.key}: </span>
                      <span className="text-xs text-muted-foreground">{mem.value}</span>
                      <div className="text-[9px] text-muted-foreground/60 mt-0.5">{CATEGORY_LABELS[mem.category]}</div>
                    </div>
                    <button type="button" onClick={() => handleDelete(mem.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {addingFor === member.id ? (
                  <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value as AiMemory['category'] }))}
                      className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
                    >
                      {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <input
                      autoFocus
                      placeholder="Nøgle (fx &quot;kan ikke lide&quot;)"
                      value={form.key}
                      onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
                    />
                    <input
                      placeholder="Værdi (fx &quot;fisk&quot;)"
                      value={form.value}
                      onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setAddingFor(null)} className="flex-1 rounded-lg bg-muted py-1.5 text-xs">Annuller</button>
                      <button type="button" onClick={handleAdd} className="flex-[2] rounded-lg bg-primary py-1.5 text-xs font-semibold text-primary-foreground">Gem</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingFor(member.id)}
                    className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
                  >
                    <Plus className="h-3 w-3" />
                    Tilføj fact
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/ai-knowledge-map.tsx
git commit -m "feat(frontend): AiKnowledgeMap — expandable family brain"
```

---

## Task 5: AiTab component

**Files:**
- Create: `packages/frontend/components/ai-tab.tsx`

- [ ] **Step 1: Create the component**

`packages/frontend/components/ai-tab.tsx`:
```tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { Send, RefreshCw } from 'lucide-react';
import type { AiSuggestion, Member } from '@mental-load/contracts';
import { getAiSuggestions, dismissAiSuggestion, triggerAiAnalysis } from '@/lib/api';
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

  function handleDone(id: string) {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      await triggerAiAnalysis();
      // Reload suggestions after a short delay
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
      {/* Header */}
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

      {/* View toggle */}
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

      {/* Content */}
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

      {/* Chat input */}
      {view === 'suggestions' && (
        <div className="border-t border-border bg-card px-3 py-2 flex items-center gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            placeholder="Spørg AI om familien…"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={!chatInput.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Confirmation sheet */}
      <AiConfirmationSheet
        suggestion={confirming}
        onClose={() => setConfirming(null)}
        onDone={handleDone}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/components/ai-tab.tsx
git commit -m "feat(frontend): AiTab — suggestions feed + Familiehjernen + chat input"
```

---

## Task 6: Wire AI tab into dashboard + bottom nav

**Files:**
- Modify: `packages/frontend/components/bottom-nav.tsx`
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Read bottom-nav.tsx**

Open `packages/frontend/components/bottom-nav.tsx`. The `NavSection` type and `NAV_ITEMS` array are there.

- [ ] **Step 2: Add AI to NavSection and NAV_ITEMS**

In `bottom-nav.tsx`:

Update `NavSection` type:
```typescript
export type NavSection = 'dashboard' | 'idag' | 'planner' | 'family' | 'ai' | 'settings';
```

Add to `NAV_ITEMS` array (insert between `family` and `settings`):
```typescript
{ key: 'ai', label: 'AI', Icon: Bot },
```

Add `Bot` to the lucide import:
```typescript
import { CalendarDays, Clock, ClipboardList, Users, Bot, Settings } from 'lucide-react';
```

- [ ] **Step 3: Import AiTab in dashboard-app.tsx**

Add import:
```typescript
import { AiTab } from '@/components/ai-tab';
```

- [ ] **Step 4: Add NavSection 'ai' to the validation in dashboard-app.tsx**

Find (around line 236):
```typescript
if (value === 'dashboard' || value === 'idag' || value === 'planner' || value === 'family' || value === 'settings')
```
Change to:
```typescript
if (value === 'dashboard' || value === 'idag' || value === 'planner' || value === 'family' || value === 'ai' || value === 'settings')
```

- [ ] **Step 5: Add AI view section in dashboard-app.tsx**

Find where the other views are rendered (e.g. `{activeNav === 'family' && (`). Add alongside them:

```tsx
{activeNav === 'ai' && (
  <AiTab members={dashboard.members} />
)}
```

- [ ] **Step 6: Typecheck + visual check**

```bash
npm run typecheck
npm run dev:frontend
```

Open http://localhost:5173 — verify AI tab appears in bottom nav and renders the suggestions view.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/components/bottom-nav.tsx packages/frontend/components/dashboard-app.tsx
git commit -m "feat(frontend): wire AI tab into dashboard navigation"
```

---

## Task 7: Inline chips — entry-details-popup

**Files:**
- Modify: `packages/frontend/components/entry-details-popup.tsx`

- [ ] **Step 1: Add state and load suggestions for this entry**

In `EntryDetailsPopup`, add after the existing `importedEntryId` state:

```typescript
const [entrySuggestions, setEntrySuggestions] = useState<import('@mental-load/contracts').AiSuggestion[]>([]);
const [confirmingSuggestion, setConfirmingSuggestion] = useState<import('@mental-load/contracts').AiSuggestion | null>(null);
```

Add a `useEffect` to load suggestions linked to this entry:

```typescript
useEffect(() => {
  getAiSuggestions()
    .then(all => setEntrySuggestions(all.filter(s => s.triggerRef === entry.id)))
    .catch(() => setEntrySuggestions([]));
}, [entry.id]);
```

Add imports:
```typescript
import { getAiSuggestions, dismissAiSuggestion } from '@/lib/api';
import { AiSuggestionCard } from '@/components/ai-suggestion-card';
import { AiConfirmationSheet } from '@/components/ai-confirmation-sheet';
```

- [ ] **Step 2: Render chips after the entry details form**

Inside the popup, after the `{entry.aulaItemId && (...)}` block and before the delete/save buttons, add:

```tsx
{entrySuggestions.length > 0 && (
  <div className="space-y-2 mt-4">
    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">🤖 AI-forslag</div>
    {entrySuggestions.map(s => (
      <AiSuggestionCard
        key={s.id}
        suggestion={s}
        onAccept={() => setConfirmingSuggestion(s)}
        onDismiss={(id) => { dismissAiSuggestion(id).catch(() => undefined); setEntrySuggestions(prev => prev.filter(x => x.id !== id)); }}
      />
    ))}
  </div>
)}

<AiConfirmationSheet
  suggestion={confirmingSuggestion}
  onClose={() => setConfirmingSuggestion(null)}
  onDone={(id) => { setEntrySuggestions(prev => prev.filter(x => x.id !== id)); }}
/>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/entry-details-popup.tsx
git commit -m "feat(frontend): inline AI chips in entry details popup"
```

---

## Task 8: Inline chips — food plan in idag-view

**Files:**
- Modify: `packages/frontend/components/idag-view.tsx`

- [ ] **Step 1: Add suggestion state and loader**

In `IDagView`, add state:
```typescript
const [foodSuggestions, setFoodSuggestions] = useState<import('@mental-load/contracts').AiSuggestion[]>([]);
const [confirmingSuggestion, setConfirmingSuggestion] = useState<import('@mental-load/contracts').AiSuggestion | null>(null);
```

Add a `useEffect` (runs once on mount):
```typescript
useEffect(() => {
  getAiSuggestions()
    .then(all => setFoodSuggestions(all.filter(s => s.category === 'food')))
    .catch(() => setFoodSuggestions([]));
}, []);
```

Add imports:
```typescript
import { getAiSuggestions, dismissAiSuggestion } from '@/lib/api';
import { AiSuggestionCard } from '@/components/ai-suggestion-card';
import { AiConfirmationSheet } from '@/components/ai-confirmation-sheet';
```

- [ ] **Step 2: Render food suggestions after the meal strip**

After the `<MealDetailSheet .../>` line, add:

```tsx
{foodSuggestions.length > 0 && (
  <div className="space-y-2">
    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">🤖 AI — madforslag</div>
    {foodSuggestions.map(s => (
      <AiSuggestionCard
        key={s.id}
        suggestion={s}
        onAccept={() => setConfirmingSuggestion(s)}
        onDismiss={(id) => { dismissAiSuggestion(id).catch(() => undefined); setFoodSuggestions(prev => prev.filter(x => x.id !== id)); }}
      />
    ))}
  </div>
)}

<AiConfirmationSheet
  suggestion={confirmingSuggestion}
  onClose={() => setConfirmingSuggestion(null)}
  onDone={(id) => { setFoodSuggestions(prev => prev.filter(x => x.id !== id)); }}
/>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/idag-view.tsx
git commit -m "feat(frontend): inline AI food suggestions in I dag view"
```

---

## Task 9: Member fact chips in Familie view

**Files:**
- Modify: `packages/frontend/components/familie-view.tsx`

- [ ] **Step 1: Add memory state to FamilieView**

Add state and loader to `FamilieView`:
```typescript
const [memories, setMemories] = useState<import('@mental-load/contracts').AiMemory[]>([]);

useEffect(() => {
  getAiMemory().then(setMemories).catch(() => setMemories([]));
}, []);
```

Add import:
```typescript
import { getAiMemory } from '@/lib/api';
```

- [ ] **Step 2: Render fact chips on each member card header**

Inside the card header (after the presence label and before the progress bar), add:

```tsx
{/* AI fact chips */}
{(() => {
  const memberFacts = memories.filter(m => m.memberId === member.id).slice(0, 3);
  if (memberFacts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {memberFacts.map(fact => (
        <span key={fact.id} className="inline-flex items-center gap-0.5 rounded-full bg-muted/60 border border-border px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
          {fact.source === 'ai' ? '🤖' : '✏️'} {fact.key}
        </span>
      ))}
    </div>
  );
})()}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/familie-view.tsx
git commit -m "feat(frontend): AI fact chips on member cards in Familie view"
```

---

## Task 10: Settings → AI editor tab

**Files:**
- Modify: `packages/frontend/components/mobile/mobile-settings-content.tsx`

- [ ] **Step 1: Read the tabs section in mobile-settings-content.tsx**

Open `packages/frontend/components/mobile/mobile-settings-content.tsx` and find the `TABS` array and the tab rendering switch.

- [ ] **Step 2: Add 'ai' to TABS**

Find the tabs array (look for `{ id: 'assistant', label: 'Assistent' }`) and add after it:
```typescript
{ id: 'ai', label: 'AI Viden' },
```

- [ ] **Step 3: Add AiTab content rendering**

Find the switch/if block that renders tab content and add:

```tsx
{activeTab === 'ai' && settings && (
  <AiKnowledgeMapSettings members={members} />
)}
```

- [ ] **Step 4: Create AiKnowledgeMapSettings sub-component**

At the bottom of `mobile-settings-content.tsx`, add:

```tsx
/* ─── AI Knowledge Settings ─── */
function AiKnowledgeMapSettings({ members }: { members: Member[] }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');

  async function handleAnalyze() {
    setAnalyzing(true);
    setMessage('');
    try {
      await triggerAiAnalysis();
      setMessage('Analyse igangsat — forslag opdateres inden for et par sekunder.');
    } catch {
      setMessage('Kunne ikke starte analyse.');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className={LABEL}>Familiehjernen</p>
        <p className="text-xs text-muted-foreground mb-3">Hvad AI ved om jeres familie. Tilføj, rediger og slet facts.</p>
        <AiKnowledgeMap members={members} />
      </div>
      <div>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {analyzing ? 'Analyserer…' : '🔄 Kør AI-analyse nu'}
        </button>
        {message && <p className="text-xs text-muted-foreground mt-2">{message}</p>}
      </div>
    </div>
  );
}
```

Add imports at the top of the file:
```typescript
import { AiKnowledgeMap } from '@/components/ai-knowledge-map';
import { triggerAiAnalysis } from '@/lib/api';
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/components/mobile/mobile-settings-content.tsx
git commit -m "feat(frontend): AI knowledge editor in Settings → AI Viden"
```

---

## Task 11: Final QA

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```
Expected: 0 errors

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | grep "^.*error" | head -5
```
Expected: 0 errors

- [ ] **Step 3: Visual check**

```bash
npm run dev:frontend
```

Check:
- AI tab appears in bottom nav (🤖 AI)
- Suggestions feed renders with group headings
- Familiehjernen toggle works, member bubbles expand
- Accept on suggestion opens confirmation sheet
- Confirm in sheet calls execute endpoint
- Familie view shows fact chips per member
- Settings → AI Viden shows editable knowledge map

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: AI proactive assistant frontend — complete"
```
