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
  filterMemberId?: string;
}

export function AiKnowledgeMap({ members, filterMemberId }: Props) {
  const [memories, setMemories] = useState<AiMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(filterMemberId ?? null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
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
                      placeholder='Nøgle (fx "kan ikke lide")'
                      value={form.key}
                      onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
                    />
                    <input
                      placeholder='Værdi (fx "fisk")'
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
