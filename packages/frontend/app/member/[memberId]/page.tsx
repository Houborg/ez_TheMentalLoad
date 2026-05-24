'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, CheckSquare, LoaderCircle, Users } from 'lucide-react';
import type { AulaPresence, Entry, ListTodayMemberTimelineResponse, Member, TimelineTaskInstance } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { AppSidebar } from '@/components/app-sidebar';
import { EntryDetailsPopup } from '@/components/entry-details-popup';
import { TodayTimelineBoard } from '@/components/today-timeline-board';
import { MemberSchoolSchedule } from '@/components/aula/member-school-schedule';
import { MemberHomework } from '@/components/aula/member-homework';
import { MemberPresenceBadge } from '@/components/aula/member-presence-badge';
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

const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

export default function MemberPage() {
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [members, setMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [timelineByMemberId, setTimelineByMemberId] = useState<Record<string, ListTodayMemberTimelineResponse>>({});
  const [celebrationTaskId, setCelebrationTaskId] = useState<string | undefined>();
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [presence, setPresence] = useState<AulaPresence | null>(null);

  useEffect(() => {
    if (!memberId) {
      return;
    }

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
        if (!selectedMember) {
          throw new Error('Member not found');
        }

        let timeline: ListTodayMemberTimelineResponse;
        try {
          timeline = await loadTodayTimeline(memberId);
        } catch {
          timeline = {
            settings: {
              memberId,
              enabled: false,
              maxTasksPerDay: 10,
              updatedAt: new Date().toISOString(),
            },
            timeline: {
              memberId,
              date: new Date().toISOString().slice(0, 10),
              timezone: 'UTC',
              tasks: [],
            },
          };
        }

        if (!active) {
          return;
        }

        setMembers(snapshot.members);
        setMember(selectedMember);
        setEntries(upcoming.filter((entry) => {
          if (entry.ownerMemberId === selectedMember.id) {
            return true;
          }
          if (entry.assignedToMemberId === selectedMember.id) {
            return true;
          }
          return entry.checklist.some((item) => item.assignedToMemberId === selectedMember.id);
        }));
        setTimelineByMemberId({ [selectedMember.id]: timeline });
        const presenceItem = presenceRes.items?.[0];
        setPresence((presenceItem?.raw_json as AulaPresence | undefined) ?? null);
        localStorage.setItem('activeMemberId', selectedMember.id);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : 'Could not load member page');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadMemberPage();
    return () => {
      active = false;
    };
  }, [memberId]);

  const memberColorById = useMemo(() => {
    if (!member) {
      return {} as Record<string, string>;
    }

    return {
      [member.id]: MEMBER_COLOR_CLASSES[0],
    };
  }, [member]);

  const memberTasks = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      status: 'completed' | 'open';
      source: 'standalone' | 'event_checklist';
      dueAt?: string;
      eventTitle?: string;
      eventId?: string;
      checklistItemId?: string;
      entryId: string;
    }> = [];

    for (const entry of entries) {
      const entryId = getEntryMutationId(entry.id);

      if (entry.type === 'task') {
        const relevantToMember = (entry.assignedToMemberId ?? entry.ownerMemberId) === memberId;
        if (!relevantToMember) {
          continue;
        }
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

      for (const checklistItem of entry.checklist) {
        const relevantToMember = (checklistItem.assignedToMemberId ?? entry.ownerMemberId) === memberId;
        if (!relevantToMember) {
          continue;
        }
        items.push({
          id: `check:${entryId}:${checklistItem.id}`,
          title: checklistItem.text,
          status: checklistItem.isCompleted ? 'completed' : 'open',
          source: 'event_checklist',
          dueAt: entry.startTime,
          eventTitle: entry.title,
          eventId: entryId,
          checklistItemId: checklistItem.id,
          entryId,
        });
      }
    }

    items.sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'open' ? -1 : 1;
      }
      if (left.dueAt && right.dueAt && left.dueAt !== right.dueAt) {
        return left.dueAt.localeCompare(right.dueAt);
      }
      if (left.dueAt && !right.dueAt) {
        return -1;
      }
      if (!left.dueAt && right.dueAt) {
        return 1;
      }
      return left.title.localeCompare(right.title);
    });

    return items;
  }, [entries, memberId]);

  async function reloadMemberEntriesAndTimeline(): Promise<void> {
    const [upcoming, refreshedTimeline] = await Promise.all([
      loadUpcomingOccurrences(30),
      loadTodayTimeline(memberId),
    ]);

    setEntries(upcoming.filter((entry) => {
      if (entry.ownerMemberId === memberId) {
        return true;
      }
      if (entry.assignedToMemberId === memberId) {
        return true;
      }
      return entry.checklist.some((item) => item.assignedToMemberId === memberId);
    }));
    setTimelineByMemberId((current) => ({ ...current, [memberId]: refreshedTimeline }));
  }

  async function handleCompleteMemberTask(taskId: string) {
    try {
      setErrorText('');
      if (taskId.startsWith('entry:')) {
        const entryId = taskId.slice(6);
        await updateEntry(entryId, { status: 'completed' });
        await reloadMemberEntriesAndTimeline();
        return;
      }

      if (!taskId.startsWith('check:')) {
        return;
      }

      const payload = taskId.slice(6);
      const separator = payload.lastIndexOf(':');
      if (separator === -1) {
        return;
      }

      const eventId = payload.slice(0, separator);
      const checklistItemId = payload.slice(separator + 1);
      const sourceEntry = entries.find((entry) => getEntryMutationId(entry.id) === eventId);
      if (!sourceEntry) {
        return;
      }

      const updatedChecklist = sourceEntry.checklist.map((item) => (
        item.id === checklistItemId ? { ...item, isCompleted: true } : item
      ));

      await updateEntry(eventId, {
        checklist: updatedChecklist.map((item) => ({
          text: item.text,
          isCompleted: item.isCompleted,
          assignedToMemberId: item.assignedToMemberId,
        })),
      });
      await reloadMemberEntriesAndTimeline();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not complete task');
    }
  }

  async function handleDeleteTask(memberIdToDelete: string, taskId: string) {
    try {
      await deleteMemberTimelineTask(memberIdToDelete, taskId);
      const refreshed = await loadTodayTimeline(memberIdToDelete);
      setTimelineByMemberId((current) => ({ ...current, [memberIdToDelete]: refreshed }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete timeline task');
    }
  }

  async function handleConfirmTask(memberIdToConfirm: string, taskId: string) {
    try {
      setErrorText('');
      const result = await confirmTodayTimelineTask(memberIdToConfirm, { taskId });
      setTimelineByMemberId((current) => ({
        ...current,
        [memberIdToConfirm]: {
          ...(current[memberIdToConfirm] ?? {
            settings: { memberId: memberIdToConfirm, enabled: true, maxTasksPerDay: 10, updatedAt: new Date().toISOString() },
          }),
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
    if (!linked) {
      return;
    }

    const found = entries.find((entry) => getEntryMutationId(entry.id) === linked);
    if (!found) {
      return;
    }

    setSelectedEntry(found);
  }

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
      <div className="flex min-h-screen">
        <AppSidebar activeSection="family" members={members} activeMemberId={member.id} />
        <main className="flex min-h-screen flex-1 flex-col px-4 py-6 md:px-8">
          <div className="mx-auto flex w-full max-w-none flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  Member view
                </div>
                <h1 className="text-3xl font-semibold tracking-tight">{member.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">Calendar, agenda, tasks, and today timeline for this member only.</p>
              </div>
              <div className="flex items-center gap-2">
                <MemberPresenceBadge presence={presence} />
                <Link href="/" className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 py-2 text-sm font-medium hover:bg-accent/60">
                  <ArrowLeft className="h-4 w-4" />
                  Back to dashboard
                </Link>
              </div>
            </div>

            {errorText ? (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                {errorText}
              </div>
            ) : null}

            <div className="grid gap-5 md:grid-cols-2">
              <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Calendar view</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Agenda view for the next 7 days.</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
                    <div className={cn('flex h-6 w-6 items-center justify-center rounded-full text-primary-foreground', memberColorById[member.id] ?? 'bg-primary')}>
                      {member.avatar ? <span className="text-sm">{member.avatar}</span> : <Users className="h-3.5 w-3.5" />}
                    </div>
                    <span>{member.role}</span>
                  </div>
                </div>
                <div className="rounded-[30px] border border-border/60 bg-card/35 p-3">
                  <AgendaView
                    members={[member]}
                    entries={entries}
                    memberColorById={memberColorById}
                    onSelectEntry={(entry) => setSelectedEntry(entry)}
                  />
                </div>
              </section>

              <MemberSchoolSchedule memberId={memberId} memberName={member.name} />

              <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Tasks</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Unified tasks from entries storage (event checklists + standalone tasks).</p>
                  </div>
                  <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{memberTasks.length} tasks</div>
                </div>
                {memberTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No tasks found for this member.</div>
                ) : (
                  <div className="grid gap-2">
                    {memberTasks.map((task) => (
                      <div key={task.id} className="rounded-2xl border border-border/60 bg-card/50 px-4 py-3">
                        <div
                          className="flex cursor-pointer items-start justify-between gap-3"
                          onClick={() => {
                            const found = entries.find((entry) => getEntryMutationId(entry.id) === task.entryId);
                            if (found) {
                              setSelectedEntry(found);
                            }
                          }}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              {task.status === 'completed' ? <Check className="h-4 w-4 text-emerald-500" /> : null}
                              <div className={cn('text-sm font-semibold', task.status === 'completed' && 'line-through text-muted-foreground')}>{task.title}</div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {task.source === 'standalone' ? 'standalone task' : `event checklist${task.eventTitle ? ` · ${task.eventTitle}` : ''}`}
                              {' · '}
                              {task.dueAt ? new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No due time'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {task.status !== 'completed' ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCompleteMemberTask(task.id);
                                }}
                                className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20"
                              >
                                Complete
                              </button>
                            ) : null}
                            <div className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.08em]', task.status === 'completed' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>
                              <CheckSquare className="h-3.5 w-3.5" />
                              {task.status === 'completed' ? 'Done' : 'Open'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <MemberHomework memberId={memberId} memberName={member.name} />
            </div>

            <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              <TodayTimelineBoard
                members={[member]}
                timelinesByMemberId={timelineByMemberId}
                celebrationTaskId={celebrationTaskId}
                onConfirmTask={handleConfirmTask}
                onDeleteTask={handleDeleteTask}
                onSelectTask={(_memberId, task) => handleOpenTaskDetails(task)}
              />
            </section>
          </div>
        </main>
      </div>

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
  const separatorIndex = id.indexOf(':');
  if (separatorIndex === -1) {
    return id;
  }
  return id.slice(0, separatorIndex);
}
