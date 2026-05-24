'use client';

import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, ChevronDown, ChevronRight } from 'lucide-react';
import { aulaGetItems, type AulaItem } from '@/lib/aula-api';
import { htmlExcerpt } from '@/lib/aula-html';
import { MuTaskDetailSheet } from './mu-task-detail-sheet';

interface Props {
  memberId: string;
  memberName: string;
}

type Bucket = 'overdue' | 'thisWeek' | 'later' | 'done';

function subjectColor(subject?: string): string {
  if (!subject) return 'bg-slate-500/15 text-slate-700';
  const palettes = [
    'bg-rose-500/15 text-rose-700',
    'bg-amber-500/15 text-amber-700',
    'bg-emerald-500/15 text-emerald-700',
    'bg-sky-500/15 text-sky-700',
    'bg-violet-500/15 text-violet-700',
    'bg-fuchsia-500/15 text-fuchsia-700',
  ];
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}

function bucketFor(dueIso?: string, status?: string): Bucket {
  if (status === 'done') return 'done';
  if (!dueIso) return 'later';
  const due = new Date(dueIso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due < today) return 'overdue';
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() + (7 - ((today.getDay() + 6) % 7)));
  return due <= sunday ? 'thisWeek' : 'later';
}

function relativeDanish(dueIso?: string): string {
  if (!dueIso) return 'Ingen frist';
  const due = new Date(dueIso);
  const today = new Date();
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'i dag';
  if (days === 1) return 'i morgen';
  if (days === -1) return 'i går';
  if (days > 1) return `om ${days} dage`;
  return `for ${Math.abs(days)} dage siden`;
}

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: 'Forfaldne',
  thisWeek: 'Denne uge',
  later: 'Senere',
  done: 'Færdige',
};

export function MemberHomework({ memberId, memberName }: Props) {
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<AulaItem | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    aulaGetItems({ type: 'mu_task', memberId, pageSize: 100 })
      .then(res => { if (active) setItems(res.items); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId]);

  const grouped = useMemo(() => {
    const out: Record<Bucket, AulaItem[]> = { overdue: [], thisWeek: [], later: [], done: [] };
    for (const item of items) {
      const status = (item.raw_json as { status?: string })?.status;
      out[bucketFor(item.published_at, status)].push(item);
    }
    for (const b of Object.values(out)) {
      b.sort((a, b) => (a.published_at ?? '').localeCompare(b.published_at ?? ''));
    }
    return out;
  }, [items]);

  if (!loading && items.length === 0) return null;

  return (
    <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
      <div className="mb-4 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Lektier</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Henter lektier…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ingen lektier registreret for {memberName}.</p>
      ) : (
        <div className="space-y-4">
          {(['overdue', 'thisWeek', 'later'] as Bucket[]).map(bucket => {
            const list = grouped[bucket];
            if (list.length === 0) return null;
            return (
              <div key={bucket}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {BUCKET_LABELS[bucket]} ({list.length})
                </div>
                <div className="space-y-1.5">
                  {list.map(task => {
                    const raw = task.raw_json as { subject?: string; status?: string } | undefined;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => setSelectedTask(task)}
                        className="block w-full rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-left hover:border-primary/50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {raw?.subject && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${subjectColor(raw.subject)}`}>
                                  {raw.subject}
                                </span>
                              )}
                              <span className="truncate text-sm font-medium">{task.title}</span>
                            </div>
                            {task.body && (
                              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                                {htmlExcerpt(task.body, 80)}
                              </p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{relativeDanish(task.published_at)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {grouped.done.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setDoneOpen(v => !v)}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                {doneOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {BUCKET_LABELS.done} ({grouped.done.length})
              </button>
              {doneOpen && (
                <div className="mt-2 space-y-1.5">
                  {grouped.done.map(task => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTask(task)}
                      className="block w-full rounded-xl border border-border/40 bg-card/30 px-3 py-2 text-left opacity-70 hover:opacity-100"
                    >
                      <div className="truncate text-sm line-through">{task.title}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <MuTaskDetailSheet task={selectedTask} onClose={() => setSelectedTask(null)} />
    </section>
  );
}
