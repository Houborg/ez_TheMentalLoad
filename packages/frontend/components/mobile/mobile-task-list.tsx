'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Entry, Member } from '@mental-load/contracts';
import { loadUpcomingOccurrences, updateEntry } from '@/lib/api';
import { sameDay } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';

type Props = {
  members: Member[];
  onAddTask: () => void;
  onSelectEntry: (entry: Entry) => void;
};

type Group = { label: string; entries: Entry[] };

function groupTasks(tasks: Entry[]): Group[] {
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));

  const today: Entry[] = [];
  const thisWeek: Entry[] = [];
  const upcoming: Entry[] = [];
  const noDate: Entry[] = [];

  for (const t of tasks) {
    if (!t.startTime) { noDate.push(t); continue; }
    const d = new Date(t.startTime);
    if (sameDay(d, now)) today.push(t);
    else if (d <= endOfWeek) thisWeek.push(t);
    else if (d <= new Date(now.getTime() + 30 * 86400000)) upcoming.push(t);
    else noDate.push(t);
  }

  return [
    { label: 'I dag', entries: today },
    { label: 'Denne uge', entries: thisWeek },
    { label: 'Kommende', entries: upcoming },
    { label: 'Uden dato', entries: noDate },
  ].filter(g => g.entries.length > 0);
}

export function MobileTaskList({ members, onAddTask, onSelectEntry }: Props) {
  const [allTasks, setAllTasks] = useState<Entry[]>([]);
  const [filterMemberId, setFilterMemberId] = useState<string | 'all'>('all');
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadUpcomingOccurrences(60)
      .then(entries => setAllTasks(entries.filter(e => e.type === 'task')))
      .catch(console.error);
  }, []);

  const filtered = useMemo(() =>
    filterMemberId === 'all'
      ? allTasks
      : allTasks.filter(t => t.ownerMemberId === filterMemberId),
    [allTasks, filterMemberId]
  );

  const groups = useMemo(() => groupTasks(filtered), [filtered]);

  async function toggleDone(entry: Entry) {
    const isDone = entry.status === 'completed';
    const newStatus: Entry['status'] = isDone ? 'active' : 'completed';

    // Optimistic update
    setAllTasks(prev => prev.map(t => t.id === entry.id ? { ...t, status: newStatus } : t));
    setCompleting(s => new Set(s).add(entry.id));

    try {
      await updateEntry(entry.id, { status: newStatus });
    } catch {
      // Revert on error
      setAllTasks(prev => prev.map(t => t.id === entry.id ? { ...t, status: entry.status } : t));
    } finally {
      setCompleting(s => { const n = new Set(s); n.delete(entry.id); return n; });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold">Opgaver</h1>
        <button
          type="button"
          onClick={onAddTask}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label="Tilføj opgave"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Member filter strip */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        <button
          type="button"
          onClick={() => setFilterMemberId('all')}
          className={cn(
            'flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium',
            filterMemberId === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          Alle
        </button>
        {members.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => setFilterMemberId(m.id)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              filterMemberId === m.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-current/20 text-[9px]">{m.name[0]}</span>
            {m.name}
          </button>
        ))}
      </div>

      {/* Task groups */}
      <div className="flex-1 overflow-y-auto pb-20 px-4">
        {groups.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Ingen opgaver</p>
        )}
        {groups.map(group => (
          <div key={group.label} className="mb-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label} ({group.entries.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {group.entries.map(entry => {
                const isDone = entry.status === 'completed';
                const member = members.find(m => m.id === entry.ownerMemberId);
                return (
                  <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleDone(entry)}
                      disabled={completing.has(entry.id)}
                      className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors',
                        isDone ? 'border-primary bg-primary' : 'border-muted-foreground',
                      )}
                      aria-label={isDone ? 'Markér som ikke udført' : 'Markér som udført'}
                    >
                      {isDone && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectEntry(entry)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className={cn('text-sm truncate', isDone && 'line-through text-muted-foreground')}>
                        {entry.title}
                      </div>
                    </button>
                    {member && (
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold">
                        {member.name[0]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
