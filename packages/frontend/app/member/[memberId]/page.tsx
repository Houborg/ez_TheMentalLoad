'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckSquare, LoaderCircle, Users } from 'lucide-react';
import type { Entry, ListTodayMemberTimelineResponse, Member } from '@mental-load/contracts';
import { AgendaView } from '@/components/agenda-view';
import { TodayTimelineBoard } from '@/components/today-timeline-board';
import { cn } from '@/lib/utils';
import {
  confirmTodayTimelineTask,
  loadDashboardSnapshot,
  loadTodayTimeline,
  loadUpcomingOccurrences,
} from '@/lib/api';

const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

export default function MemberPage() {
  const params = useParams<{ memberId: string }>();
  const memberId = params.memberId;

  const [member, setMember] = useState<Member | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [timelineByMemberId, setTimelineByMemberId] = useState<Record<string, ListTodayMemberTimelineResponse>>({});
  const [celebrationTaskId, setCelebrationTaskId] = useState<string | undefined>();

  useEffect(() => {
    if (!memberId) {
      return;
    }

    let active = true;

    async function loadMemberPage() {
      try {
        setErrorText('');
        const [snapshot, upcoming] = await Promise.all([
          loadDashboardSnapshot(),
          loadUpcomingOccurrences(30),
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

        setMember(selectedMember);
        setEntries(upcoming.filter((entry) => entry.ownerMemberId === selectedMember.id));
        setTimelineByMemberId({ [selectedMember.id]: timeline });
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

  const checklistTasks = useMemo(() => {
    return entries.flatMap((entry) =>
      entry.checklist.map((item) => ({
        id: `${entry.id}-${item.id}`,
        text: item.text,
        isCompleted: item.isCompleted,
        eventTitle: entry.title,
        startTime: entry.startTime,
      })),
    );
  }, [entries]);

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
    <div className="min-h-screen bg-background px-4 py-6 text-foreground md:px-8">
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
            />
          </div>
        </section>

        <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Tasks</h2>
              <p className="mt-1 text-sm text-muted-foreground">Checklist tasks from this member&apos;s upcoming events.</p>
            </div>
            <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{checklistTasks.length} tasks</div>
          </div>
          {checklistTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No checklist tasks found in upcoming events.</div>
          ) : (
            <div className="grid gap-2">
              {checklistTasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-border/60 bg-card/50 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={cn('text-sm font-semibold', task.isCompleted && 'line-through text-muted-foreground')}>{task.text}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{task.eventTitle}</div>
                    </div>
                    <div className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.08em]', task.isCompleted ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300')}>
                      <CheckSquare className="h-3.5 w-3.5" />
                      {task.isCompleted ? 'Done' : 'Open'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
          <TodayTimelineBoard
            members={[member]}
            timelinesByMemberId={timelineByMemberId}
            celebrationTaskId={celebrationTaskId}
            onConfirmTask={handleConfirmTask}
          />
        </section>
      </div>
    </div>
  );
}
