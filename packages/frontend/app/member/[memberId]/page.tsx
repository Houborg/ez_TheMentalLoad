'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  GraduationCap,
  LoaderCircle,
  MessageSquare,
  StickyNote,
  Users,
} from 'lucide-react';
import type { AulaPresence, Entry, ListTodayMemberTimelineResponse, Member, TimelineTaskInstance } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { EntryDetailsPopup } from '@/components/entry-details-popup';
import { TodayTimelineBoard } from '@/components/today-timeline-board';
import { MemberSchoolSchedule } from '@/components/aula/member-school-schedule';
import { MemberHomework } from '@/components/aula/member-homework';
import { MemberWeekNotes } from '@/components/aula/member-week-notes';
import { MemberMessages } from '@/components/aula/member-messages';
import { MemberPresenceBadge } from '@/components/aula/member-presence-badge';
import {
  MemberSectionToggle,
  useSectionVisibility,
  type SectionDef,
  type SectionKey,
} from '@/components/member-section-toggle';
import { aulaGetItems } from '@/lib/aula-api';
import { cn } from '@/lib/utils';
import {
  confirmTodayTimelineTask,
  deleteEntry,
  deleteMemberTimelineTask,
  loadDashboardSnapshot,
  loadTodayTimeline,
  loadUpcomingOccurrences,
  updateEntry,
} from '@/lib/api';

const MEMBER_HEX_PALETTE = ['#6d5efc','#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#f97316','#14b8a6','#6366f1'];

const ALL_SECTIONS: SectionDef[] = [
  { key: 'kalender',   label: 'Kalender',   Icon: CalendarDays },
  { key: 'ugenoter',   label: 'Uge noter',  Icon: StickyNote },
  { key: 'skoleskema',  label: 'Skoleskema', Icon: BookOpen },
  { key: 'lektier',    label: 'Lektier',    Icon: GraduationCap },
  { key: 'opgaver',    label: 'Opgaver',    Icon: CheckSquare },
  { key: 'beskeder',   label: 'Beskeder',   Icon: MessageSquare },
];

const CHILD_DEFAULTS: Record<SectionKey, boolean> = {
  kalender: true,
  ugenoter: true,
  skoleskema: true,
  lektier: true,
  opgaver: true,
  beskeder: true,
};

const PARENT_DEFAULTS: Record<SectionKey, boolean> = {
  kalender: true,
  ugenoter: false,
  skoleskema: false,
  lektier: false,
  opgaver: true,
  beskeder: false,
};

export default function MemberPage() {
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [member, setMember] = useState<Member | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [timelineByMemberId, setTimelineByMemberId] = useState<Record<string, ListTodayMemberTimelineResponse>>({});
  const [celebrationTaskId, setCelebrationTaskId] = useState<string | undefined>();
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [presence, setPresence] = useState<AulaPresence | null>(null);

  const isChild = member?.role === 'child';
  const { visible, toggle } = useSectionVisibility(isChild ? CHILD_DEFAULTS : PARENT_DEFAULTS);

  useEffect(() => {
    if (!memberId) return;
    let active = true;

    async function loadMemberPage() {
      try {
        setErrorText('');
        const [snapshot, upcoming, presenceRes] = await Promise.all([
          loadDashboardSnapshot(),
          loadUpcomingOccurrences(30),
          aulaGetItems({ type: 'presence', memberId, pageSize: 1 }).catch(() => ({ items: [] as Array<{ raw_json?: AulaPresence }> })),
        ]);

        const selectedMember = snapshot.members.find((item) => item.id === memberId) ?? null;
        if (!selectedMember) throw new Error('Member not found');

        let timeline: ListTodayMemberTimelineResponse;
        try {
          timeline = await loadTodayTimeline(memberId);
        } catch {
          timeline = {
            settings: { memberId, enabled: false, maxTasksPerDay: 10, updatedAt: new Date().toISOString() },
            timeline: { memberId, date: new Date().toISOString().slice(0, 10), timezone: 'UTC', tasks: [] },
          };
        }

        if (!active) return;

        setMember(selectedMember);
        setEntries(upcoming.filter((entry) => {
          if (entry.ownerMemberId === selectedMember.id) return true;
          if (entry.assignedToMemberId === selectedMember.id) return true;
          if ((entry.visibleMemberIds ?? []).includes(selectedMember.id)) return true;
          return entry.checklist.some((item) => item.assignedToMemberId === selectedMember.id);
        }));
        setTimelineByMemberId({ [selectedMember.id]: timeline });
        const presenceItem = presenceRes.items?.[0];
        setPresence((presenceItem?.raw_json as AulaPresence | undefined) ?? null);
        localStorage.setItem('activeMemberId', selectedMember.id);
      } catch (error) {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : 'Could not load member page');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadMemberPage();
    return () => { active = false; };
  }, [memberId]);

  const memberColorById = useMemo(() => {
    if (!member) return {} as Record<string, string>;
    return { [member.id]: member.color ?? MEMBER_HEX_PALETTE[0] };
  }, [member]);

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
        if ((entry.assignedToMemberId ?? entry.ownerMemberId) !== memberId) continue;
        items.push({
          id: `entry:${entryId}`, title: entry.title,
          status: entry.status === 'completed' ? 'completed' : 'open',
          source: 'standalone', dueAt: entry.startTime, entryId,
        });
        continue;
      }
      for (const ci of entry.checklist) {
        if ((ci.assignedToMemberId ?? entry.ownerMemberId) !== memberId) continue;
        items.push({
          id: `check:${entryId}:${ci.id}`, title: ci.text,
          status: ci.isCompleted ? 'completed' : 'open',
          source: 'event_checklist', dueAt: entry.startTime, eventTitle: entry.title, entryId,
        });
      }
    }

    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt && !b.dueAt) return -1;
      if (!a.dueAt && b.dueAt) return 1;
      return a.title.localeCompare(b.title);
    });
    return items;
  }, [entries, memberId]);

  async function reloadMemberEntriesAndTimeline(): Promise<void> {
    const [upcoming, refreshedTimeline] = await Promise.all([
      loadUpcomingOccurrences(30),
      loadTodayTimeline(memberId),
    ]);
    setEntries(upcoming.filter((entry) => {
      if (entry.ownerMemberId === memberId) return true;
      if (entry.assignedToMemberId === memberId) return true;
      if ((entry.visibleMemberIds ?? []).includes(memberId)) return true;
      return entry.checklist.some((item) => item.assignedToMemberId === memberId);
    }));
    setTimelineByMemberId((c) => ({ ...c, [memberId]: refreshedTimeline }));
  }

  async function handleCompleteMemberTask(taskId: string) {
    try {
      setErrorText('');
      if (taskId.startsWith('entry:')) {
        await updateEntry(taskId.slice(6), { status: 'completed' });
        await reloadMemberEntriesAndTimeline();
        return;
      }
      if (!taskId.startsWith('check:')) return;
      const payload = taskId.slice(6);
      const sep = payload.lastIndexOf(':');
      if (sep === -1) return;
      const eventId = payload.slice(0, sep);
      const checklistItemId = payload.slice(sep + 1);
      const sourceEntry = entries.find((e) => getEntryMutationId(e.id) === eventId);
      if (!sourceEntry) return;
      await updateEntry(eventId, {
        checklist: sourceEntry.checklist.map((item) => ({
          text: item.text,
          isCompleted: item.id === checklistItemId ? true : item.isCompleted,
          assignedToMemberId: item.assignedToMemberId,
        })),
      });
      await reloadMemberEntriesAndTimeline();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not complete task');
    }
  }

  async function handleDeleteTask(mid: string, taskId: string) {
    try {
      await deleteMemberTimelineTask(mid, taskId);
      const refreshed = await loadTodayTimeline(mid);
      setTimelineByMemberId((c) => ({ ...c, [mid]: refreshed }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete timeline task');
    }
  }

  async function handleConfirmTask(mid: string, taskId: string) {
    try {
      setErrorText('');
      const result = await confirmTodayTimelineTask(mid, { taskId });
      setTimelineByMemberId((c) => ({
        ...c,
        [mid]: {
          ...(c[mid] ?? { settings: { memberId: mid, enabled: true, maxTasksPerDay: 10, updatedAt: new Date().toISOString() } }),
          timeline: result.timeline,
        },
      }));
      setCelebrationTaskId(taskId);
      setTimeout(() => setCelebrationTaskId(undefined), 1400);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not confirm timeline task');
    }
  }

  function handleOpenTaskDetails(task: TimelineTaskInstance) {
    const linked = task.linkedEntryId?.split('#')[0];
    if (!linked) return;
    const found = entries.find((entry) => getEntryMutationId(entry.id) === linked);
    if (found) setSelectedEntry(found);
  }

  // Compute visible top-row and bottom-row sections for grid
  const topVisible = (['kalender', 'ugenoter', 'beskeder'] as SectionKey[]).filter(k => visible[k]);
  const bottomVisible = (['skoleskema', 'lektier', 'opgaver'] as SectionKey[]).filter(k => visible[k]);
  const gridCols = (count: number) =>
    count === 3 ? 'md:grid-cols-3' : count === 2 ? 'md:grid-cols-2' : '';

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-6 text-foreground">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
        <div className="mx-auto max-w-5xl rounded-3xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {errorText || 'Member not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="flex min-h-screen flex-1 flex-col px-4 py-6 md:px-8">
          <div className="mx-auto flex w-full max-w-none flex-col gap-5">

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">{member.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Kalender, skole, opgaver og beskeder for dette medlem
                </p>
              </div>
              <div className="flex items-center gap-2">
                <MemberPresenceBadge presence={presence} />
                <Link href="/" className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 py-2 text-sm font-medium hover:bg-accent/60">
                  <ArrowLeft className="h-4 w-4" />
                  Tilbage
                </Link>
              </div>
            </div>

            {errorText ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                {errorText}
              </div>
            ) : null}

            {/* Section toggle bar */}
            <MemberSectionToggle sections={ALL_SECTIONS} visible={visible} onToggle={toggle} />

            {/* Top row: Kalender | Uge noter | Beskeder */}
            {topVisible.length > 0 && (
              <div className={cn('grid gap-5', gridCols(topVisible.length))}>
                {visible.kalender && (
                  <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">Kalender</h2>
                      </div>
                      <span className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
                        Næste 7 dage
                      </span>
                    </div>
                    <div className="rounded-[20px] border border-border/60 bg-card/35 p-3">
                      <AgendaView
                        members={[member]}
                        entries={entries}
                        memberColorById={memberColorById}
                        onSelectEntry={(entry) => setSelectedEntry(entry)}
                      />
                    </div>
                  </section>
                )}

                {visible.ugenoter && (
                  <MemberWeekNotes memberId={memberId} memberName={member.name} />
                )}

                {visible.beskeder && (
                  <MemberMessages memberId={memberId} memberName={member.name} />
                )}
              </div>
            )}

            {/* Bottom row: Skoleskema | Lektier | Opgaver */}
            {bottomVisible.length > 0 && (
              <div className={cn('grid gap-5', gridCols(bottomVisible.length))}>
                {visible.skoleskema && (
                  <MemberSchoolSchedule memberId={memberId} memberName={member.name} />
                )}

                {visible.lektier && (
                  <MemberHomework memberId={memberId} memberName={member.name} />
                )}

                {visible.opgaver && (
                  <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <CheckSquare className="h-5 w-5 text-primary" />
                        <h2 className="text-lg font-semibold">Opgaver</h2>
                      </div>
                      <span className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
                        {memberTasks.length} opgaver
                      </span>
                    </div>
                    {memberTasks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                        Ingen opgaver for dette medlem.
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {memberTasks.map((task) => (
                          <div key={task.id} className="rounded-2xl border border-border/60 bg-card/50 px-4 py-3">
                            <div
                              className="flex cursor-pointer items-start justify-between gap-3"
                              onClick={() => {
                                const found = entries.find((e) => getEntryMutationId(e.id) === task.entryId);
                                if (found) setSelectedEntry(found);
                              }}
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  {task.status === 'completed' ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                                  <div className={cn('text-sm font-semibold', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.title}</div>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {task.source === 'standalone' ? 'Opgave' : `Tjekliste${task.eventTitle ? ` · ${task.eventTitle}` : ''}`}
                                  {' · '}
                                  {task.dueAt ? new Date(task.dueAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : 'Ingen tid'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {task.status !== 'completed' ? (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void handleCompleteMemberTask(task.id); }}
                                    className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20"
                                  >
                                    Udfør
                                  </button>
                                ) : null}
                                <div className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.08em]',
                                  task.status === 'completed'
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                                )}>
                                  <CheckSquare className="h-3.5 w-3.5" />
                                  {task.status === 'completed' ? 'Udført' : 'Åben'}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            {/* Timeline board (always visible) */}
            <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              <TodayTimelineBoard
                members={[member]}
                timelinesByMemberId={timelineByMemberId}
                celebrationTaskId={celebrationTaskId}
                onConfirmTask={handleConfirmTask}
                onDeleteTask={handleDeleteTask}
                onSelectTask={(_mid, task) => handleOpenTaskDetails(task)}
              />
            </section>
          </div>
      </main>

      {selectedEntry ? (
        <EntryDetailsPopup
          entry={selectedEntry}
          ownerName={member.name}
          onClose={() => setSelectedEntry(null)}
          onSave={async (patch) => {
            await updateEntry(getEntryMutationId(selectedEntry.id), patch);
            await reloadMemberEntriesAndTimeline();
          }}
          onDelete={async () => {
            await deleteEntry(getEntryMutationId(selectedEntry.id));
            await reloadMemberEntriesAndTimeline();
          }}
        />
      ) : null}
    </div>
  );
}

function getEntryMutationId(id: string): string {
  const sep = id.indexOf(':');
  return sep === -1 ? id : id.slice(0, sep);
}
