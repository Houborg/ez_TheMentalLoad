'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  GraduationCap,
  LoaderCircle,
  MessageSquare,
  StickyNote,
} from 'lucide-react';
import type { AulaPresence, Entry, Member } from '@mental-load/contracts';
import { MemberSchoolSchedule } from '@/components/aula/member-school-schedule';
import { MemberHomework } from '@/components/aula/member-homework';
import { MemberWeekNotes } from '@/components/aula/member-week-notes';
import { MemberMessages } from '@/components/aula/member-messages';
import { MemberPresenceDot } from '@/components/aula/member-presence-dot';
import {
  MemberSectionToggle,
  useSectionVisibility,
  type SectionDef,
  type SectionKey,
} from '@/components/member-section-toggle';
import { aulaGetItems } from '@/lib/aula-api';
import { cn } from '@/lib/utils';
import {
  loadUpcomingOccurrences,
  updateEntry,
} from '@/lib/api';

const ALL_SECTIONS: SectionDef[] = [
  { key: 'kalender',   label: 'Kalender',   Icon: CalendarDays },
  { key: 'ugenoter',   label: 'Uge noter',  Icon: StickyNote },
  { key: 'skoleskema',  label: 'Skoleskema', Icon: BookOpen },
  { key: 'lektier',    label: 'Lektier',    Icon: GraduationCap },
  { key: 'opgaver',    label: 'Opgaver',    Icon: CheckSquare },
  { key: 'beskeder',   label: 'Beskeder',   Icon: MessageSquare },
];

const CHILD_DEFAULTS: Record<SectionKey, boolean> = {
  kalender: true, ugenoter: true, skoleskema: true,
  lektier: true, opgaver: true, beskeder: true,
};

const PARENT_DEFAULTS: Record<SectionKey, boolean> = {
  kalender: true, ugenoter: false, skoleskema: false,
  lektier: false, opgaver: true, beskeder: false,
};

type Props = {
  member: Member;
  onBack: () => void;
  onSelectEntry?: (entry: Entry) => void;
};

function getEntryMutationId(id: string): string {
  const sep = id.indexOf(':');
  return sep === -1 ? id : id.slice(0, sep);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.getTime() === today.getTime()) return 'I dag';
  if (d.getTime() === tomorrow.getTime()) return 'I morgen';

  const dayNames = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${dayNames[d.getDay()]} ${d.getDate()}. ${monthNames[d.getMonth()]}`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

export function MobileMemberView({ member, onBack, onSelectEntry }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [presence, setPresence] = useState<AulaPresence | null>(null);

  const isChild = member.role === 'child';
  const { visible, toggle } = useSectionVisibility(isChild ? CHILD_DEFAULTS : PARENT_DEFAULTS, member.id);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setErrorText('');
        const [upcoming, presenceRes] = await Promise.all([
          loadUpcomingOccurrences(30),
          aulaGetItems({ type: 'presence', memberId: member.id, pageSize: 1 }).catch(() => ({ items: [] as Array<{ raw_json?: AulaPresence }> })),
        ]);

        if (!active) return;

        setEntries(upcoming.filter(entry => {
          if (entry.ownerMemberId === member.id) return true;
          if (entry.assignedToMemberId === member.id) return true;
          if ((entry.visibleMemberIds ?? []).includes(member.id)) return true;
          return entry.checklist.some(item => item.assignedToMemberId === member.id);
        }));

        const presenceItem = presenceRes.items?.[0];
        setPresence((presenceItem?.raw_json as AulaPresence | undefined) ?? null);
      } catch (error) {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : 'Kunne ikke hente data');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [member.id]);

  // Group entries by date for mobile agenda
  const agendaDays = useMemo(() => {
    const dayMap = new Map<string, Entry[]>();
    for (const entry of entries) {
      const dateStr = entry.startTime
        ? new Date(entry.startTime).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const existing = dayMap.get(dateStr) ?? [];
      existing.push(entry);
      dayMap.set(dateStr, existing);
    }
    // Sort days
    const sorted = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    // Sort entries within each day by time
    for (const [, dayEntries] of sorted) {
      dayEntries.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return sorted;
  }, [entries]);

  // Compute tasks for the member (standalone tasks + event checklist items)
  const memberTasks = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      status: 'completed' | 'open';
      source: 'standalone' | 'event_checklist';
      dueAt?: string;
      eventTitle?: string;
      entryId: string;
    }> = [];

    for (const entry of entries) {
      const entryId = getEntryMutationId(entry.id);

      if (entry.type === 'task') {
        const relevant = (entry.assignedToMemberId ?? entry.ownerMemberId) === member.id;
        if (!relevant) continue;
        items.push({
          id: `entry:${entryId}`,
          title: entry.title,
          status: entry.status === 'completed' ? 'completed' : 'open',
          source: 'standalone',
          dueAt: entry.startTime,
          entryId,
        });
        continue;
      }

      for (const ci of entry.checklist) {
        const relevant = (ci.assignedToMemberId ?? entry.ownerMemberId) === member.id;
        if (!relevant) continue;
        items.push({
          id: `check:${entryId}:${ci.id}`,
          title: ci.text,
          status: ci.isCompleted ? 'completed' : 'open',
          source: 'event_checklist',
          dueAt: entry.startTime,
          eventTitle: entry.title,
          entryId,
        });
      }
    }

    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return a.title.localeCompare(b.title);
    });

    return items;
  }, [entries, member.id]);

  async function handleCompleteTask(taskId: string) {
    try {
      setErrorText('');
      if (taskId.startsWith('entry:')) {
        const entryId = taskId.slice(6);
        await updateEntry(entryId, { status: 'completed' });
        // Reload entries
        const upcoming = await loadUpcomingOccurrences(30);
        setEntries(upcoming.filter(entry => {
          if (entry.ownerMemberId === member.id) return true;
          if (entry.assignedToMemberId === member.id) return true;
          if ((entry.visibleMemberIds ?? []).includes(member.id)) return true;
          return entry.checklist.some(item => item.assignedToMemberId === member.id);
        }));
        return;
      }

      if (!taskId.startsWith('check:')) return;
      const payload = taskId.slice(6);
      const sep = payload.lastIndexOf(':');
      if (sep === -1) return;

      const eventId = payload.slice(0, sep);
      const checklistItemId = payload.slice(sep + 1);
      const sourceEntry = entries.find(e => getEntryMutationId(e.id) === eventId);
      if (!sourceEntry) return;

      const updatedChecklist = sourceEntry.checklist.map(item =>
        item.id === checklistItemId ? { ...item, isCompleted: true } : item
      );

      await updateEntry(eventId, {
        checklist: updatedChecklist.map(item => ({
          text: item.text,
          isCompleted: item.isCompleted,
          assignedToMemberId: item.assignedToMemberId,
        })),
      });

      const upcoming = await loadUpcomingOccurrences(30);
      setEntries(upcoming.filter(entry => {
        if (entry.ownerMemberId === member.id) return true;
        if (entry.assignedToMemberId === member.id) return true;
        return entry.checklist.some(item => item.assignedToMemberId === member.id);
      }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Kunne ikke fuldføre opgaven');
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-30 bg-background flex flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <button type="button" onClick={onBack} className="text-sm text-primary">
            ← Tilbage
          </button>
          <h1 className="font-semibold text-sm">{member.name}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-30 bg-background flex flex-col">
      {/* Header with back button + member info */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 flex-shrink-0">
        <button type="button" onClick={onBack} className="text-sm text-primary">
          ← Tilbage
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold">
              {member.avatar || member.name[0]}
            </div>
            <MemberPresenceDot
              presence={presence}
              size="sm"
              className="absolute -bottom-0.5 -right-0.5"
            />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-sm truncate">{member.name}</h1>
            {presence?.statusLabel && (
              <div className="text-[11px] text-primary">{presence.statusLabel}</div>
            )}
          </div>
        </div>
      </div>

      {/* Toggle bar */}
      <div className="px-4 pt-3 pb-1 flex-shrink-0 overflow-x-auto">
        <MemberSectionToggle sections={ALL_SECTIONS} visible={visible} onToggle={toggle} />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto pb-24">
        {errorText && (
          <div className="mx-4 mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {errorText}
          </div>
        )}

        {/* ── Section 1: Kalender ── */}
        {visible.kalender && (
          <section className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Kalender</h2>
              <span className="text-xs text-muted-foreground">Næste 30 dage</span>
            </div>

            {agendaDays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground text-center">
                Ingen begivenheder
              </div>
            ) : (
              <div className="space-y-3">
                {agendaDays.map(([dateStr, dayEntries]) => (
                  <div key={dateStr}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-primary mb-1.5">
                      {formatDateLabel(dateStr)}
                    </div>
                    <div className="space-y-1">
                      {dayEntries.map(entry => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => onSelectEntry?.(entry)}
                          className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-left active:bg-accent/60 transition-colors"
                        >
                          {/* Time column */}
                          <div className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground pt-0.5">
                            {entry.allDay ? 'Heldag' : formatTime(entry.startTime) || '—'}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{entry.title}</div>
                            {entry.location && (
                              <div className="text-xs text-muted-foreground truncate mt-0.5">{entry.location}</div>
                            )}
                          </div>

                          {/* Type badge */}
                          <div className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium',
                            entry.type === 'task'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-primary/15 text-primary',
                          )}>
                            {entry.type === 'task' ? 'Opgave' : 'Event'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Section 2: Uge noter ── */}
        {visible.ugenoter && (
          <section className="px-4 pt-2 pb-2">
            <MemberWeekNotes memberId={member.id} memberName={member.name} />
          </section>
        )}

        {/* ── Section 3: Skoleskema ── */}
        {visible.skoleskema && (
          <section className="px-4 pt-2 pb-2">
            <MemberSchoolSchedule memberId={member.id} memberName={member.name} memberColor={member.color} />
          </section>
        )}

        {/* ── Section 4: Lektier ── */}
        {visible.lektier && (
          <section className="px-4 pt-2 pb-2">
            <MemberHomework memberId={member.id} memberName={member.name} />
          </section>
        )}

        {/* ── Section 5: Opgaver ── */}
        {visible.opgaver && (
          <section className="px-4 pt-2 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Opgaver</h2>
              <span className="text-xs text-muted-foreground">{memberTasks.length} opgaver</span>
            </div>

            {memberTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-sm text-muted-foreground text-center">
                Ingen opgaver
              </div>
            ) : (
              <div className="space-y-1.5">
                {memberTasks.map(task => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5"
                  >
                    {/* Complete button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (task.status !== 'completed') void handleCompleteTask(task.id);
                      }}
                      className={cn(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                        task.status === 'completed'
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-border hover:border-primary',
                      )}
                    >
                      {task.status === 'completed' && <Check className="h-3 w-3" />}
                    </button>

                    {/* Task info */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        const found = entries.find(e => getEntryMutationId(e.id) === task.entryId);
                        if (found) onSelectEntry?.(found);
                      }}
                    >
                      <div className={cn(
                        'text-sm font-medium',
                        task.status === 'completed' && 'line-through text-muted-foreground',
                      )}>
                        {task.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {task.source === 'standalone' ? 'Opgave' : `Tjekliste · ${task.eventTitle ?? ''}`}
                        {task.dueAt ? ` · ${formatTime(task.dueAt)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Section 6: Beskeder ── */}
        {visible.beskeder && (
          <section className="px-4 pt-2 pb-4">
            <MemberMessages memberId={member.id} memberName={member.name} />
          </section>
        )}
      </div>
    </div>
  );
}
