'use client';

import { CheckCircle2, Clock3, Gift, Sparkles, Trash2 } from 'lucide-react';
import type { ListTodayMemberTimelineResponse, Member, TimelineTaskInstance } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

type TodayTimelineBoardProps = {
  members: Member[];
  timelinesByMemberId: Record<string, ListTodayMemberTimelineResponse>;
  onConfirmTask: (memberId: string, taskId: string) => Promise<void>;
  onDeleteTask?: (memberId: string, taskId: string) => Promise<void>;
  onSelectTask?: (memberId: string, task: TimelineTaskInstance) => void;
  celebrationTaskId?: string;
};

type TimelineVisualState = 'done' | 'active' | 'upcoming' | 'skipped';

const HOUR_MARKS = [0, 6, 12, 18, 24];
const TASK_CARD_WIDTH_PX = 220;
const TASK_CARD_HALF_PX = TASK_CARD_WIDTH_PX / 2;
const TASK_LANE_TOP_START_PX = 116;
const TASK_LANE_HEIGHT_PX = 122;
const TASK_MIN_GAP_PERCENT = 24;

function formatTaskTime(input?: string) {
  if (!input) {
    return 'No due time';
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return 'No due time';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getVisualState(status: string): TimelineVisualState {
  if (status === 'completed') {
    return 'done';
  }

  if (status === 'waiting_confirmation') {
    return 'active';
  }

  if (status === 'skipped') {
    return 'skipped';
  }

  return 'upcoming';
}

function getSelectedTask(tasks: TimelineTaskInstance[]) {
  return tasks.find((task) => task.status === 'waiting_confirmation')
    ?? tasks.find((task) => task.status === 'pending')
    ?? [...tasks].reverse().find((task) => task.status === 'completed')
    ?? tasks[0];
}

function buildDateAtTime(date: string, hours: number, minutes: number) {
  return new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
}

function getDayProgressPercent(date: string) {
  const now = new Date();
  const dayStart = buildDateAtTime(date, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  if (now <= dayStart) {
    return 0;
  }

  if (now >= dayEnd) {
    return 100;
  }

  return ((now.getTime() - dayStart.getTime()) / (dayEnd.getTime() - dayStart.getTime())) * 100;
}

function getTaskPositionPercent(task: TimelineTaskInstance, index: number, total: number) {
  if (task.dueAt) {
    const dueAt = new Date(task.dueAt);
    if (!Number.isNaN(dueAt.getTime())) {
      return ((dueAt.getHours() * 60 + dueAt.getMinutes()) / (24 * 60)) * 100;
    }
  }

  if (total <= 1) {
    return 8;
  }

  return 8 + (index / (total - 1)) * 84;
}

function getStatusTone(status: TimelineTaskInstance['status']) {
  if (status === 'completed') {
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  }

  if (status === 'waiting_confirmation') {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  }

  if (status === 'skipped') {
    return 'bg-muted text-muted-foreground';
  }

  return 'bg-blue-500/15 text-blue-700 dark:text-blue-300';
}

function buildTaskLayout(tasks: TimelineTaskInstance[]) {
  const leftByTaskId = new Map<string, number>();
  const laneByTaskId = new Map<string, number>();
  const laneLastLeft: number[] = [];

  const positioned = tasks
    .map((task, index) => ({
      task,
      index,
      left: getTaskPositionPercent(task, index, tasks.length),
    }))
    .sort((a, b) => {
      if (a.left !== b.left) {
        return a.left - b.left;
      }
      return a.index - b.index;
    });

  for (const item of positioned) {
    let chosenLane = -1;
    for (let lane = 0; lane < laneLastLeft.length; lane += 1) {
      if (item.left - laneLastLeft[lane] >= TASK_MIN_GAP_PERCENT) {
        chosenLane = lane;
        break;
      }
    }

    if (chosenLane === -1) {
      chosenLane = laneLastLeft.length;
      laneLastLeft.push(item.left);
    } else {
      laneLastLeft[chosenLane] = item.left;
    }

    leftByTaskId.set(item.task.id, item.left);
    laneByTaskId.set(item.task.id, chosenLane);
  }

  return {
    leftByTaskId,
    laneByTaskId,
    laneCount: Math.max(1, laneLastLeft.length),
  };
}

type MemberTimelineLaneProps = {
  member: Member;
  data: ListTodayMemberTimelineResponse;
  onConfirmTask: (memberId: string, taskId: string) => Promise<void>;
  onDeleteTask?: (memberId: string, taskId: string) => Promise<void>;
  onSelectTask?: (memberId: string, task: TimelineTaskInstance) => void;
  celebrationTaskId?: string;
};

function MemberTimelineLane({ member, data, onConfirmTask, onDeleteTask, onSelectTask, celebrationTaskId }: MemberTimelineLaneProps) {
  const tasks = data.timeline.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const milestones = tasks.filter((task) => task.isMilestone).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const activeTask = getSelectedTask(tasks);
  const dayProgressPercent = getDayProgressPercent(data.timeline.date);
  const { leftByTaskId, laneByTaskId, laneCount } = buildTaskLayout(tasks);
  const timelineHeight = Math.max(360, TASK_LANE_TOP_START_PX + laneCount * TASK_LANE_HEIGHT_PX + 28);

  return (
    <article className="rounded-[28px] border border-border/60 bg-background/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{member.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {tasks.length} tasks · {progress}% completed · {milestones} milestones
          </p>
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-2 md:max-w-xs">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Task progress</span>
            <span>{completed}/{tasks.length || 0}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border/60 bg-card/50 px-4 py-8 text-sm text-muted-foreground">
          No tasks generated for this member today.
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto overflow-y-hidden overscroll-y-none snap-x snap-mandatory scroll-px-6 pb-2 [touch-action:pan-x]">
            <div className="min-w-[900px] snap-start">
              <div className="relative rounded-[26px] border border-border/50 bg-card/40 px-6 py-6" style={{ height: `${timelineHeight}px` }}>
                <div className="pointer-events-none absolute inset-x-6 top-12 flex justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {HOUR_MARKS.map((hour) => (
                    <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
                  ))}
                </div>

                <div className="absolute inset-x-6 top-24 h-1 rounded-full bg-muted" />
                <div className="absolute inset-x-6 top-24 h-1 rounded-full bg-primary/20">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${dayProgressPercent}%` }} />
                </div>
                <div
                  className="absolute top-[74px] h-11 w-px bg-primary/70"
                  style={{ left: `calc(1.5rem + (${dayProgressPercent} / 100) * (100% - 3rem))` }}
                >
                  <span className="absolute left-1/2 top-[-26px] -translate-x-1/2 rounded-full bg-primary px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground">
                    Now
                  </span>
                </div>

                {tasks.map((task, index) => {
                  const visualState = getVisualState(task.status);
                  const left = leftByTaskId.get(task.id) ?? getTaskPositionPercent(task, index, tasks.length);
                  const lane = laneByTaskId.get(task.id) ?? 0;
                  const top = TASK_LANE_TOP_START_PX + lane * TASK_LANE_HEIGHT_PX;

                  return (
                    <div
                      key={task.id}
                      className="absolute w-[220px] -translate-x-1/2"
                      style={{
                        top: `${top}px`,
                        left: `clamp(${TASK_CARD_HALF_PX}px, calc(1.5rem + (${left} / 100) * (100% - 3rem)), calc(100% - ${TASK_CARD_HALF_PX}px))`,
                      }}
                    >
                      <div className="flex justify-center">
                        <div className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-full border-2 text-sm font-semibold shadow-lg',
                          visualState === 'done' && 'border-emerald-400/70 bg-emerald-500 text-white',
                          visualState === 'active' && 'border-amber-400/70 bg-amber-500 text-white',
                          visualState === 'upcoming' && 'border-border/70 bg-card text-muted-foreground',
                          visualState === 'skipped' && 'border-border/50 bg-muted text-muted-foreground',
                        )}>
                          {task.isMilestone ? <Gift className="h-4 w-4" /> : task.status === 'completed' ? '✓' : task.position}
                        </div>
                      </div>
                      <div className={cn(
                        'mt-3 rounded-2xl border border-border/60 bg-background/90 p-3 shadow-lg shadow-black/10',
                        onSelectTask && 'cursor-pointer transition hover:bg-accent/20',
                        celebrationTaskId === task.id && 'ring-2 ring-amber-400/60',
                      )}
                      onClick={() => onSelectTask?.(member.id, task)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{task.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="h-3.5 w-3.5" />
                                {formatTaskTime(task.dueAt)}
                              </span>
                              <span className={cn('rounded-full px-2 py-1 font-medium uppercase tracking-[0.08em]', getStatusTone(task.status))}>
                                {task.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {task.status === 'waiting_confirmation' ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onConfirmTask(member.id, task.id);
                                }}
                                className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg shadow-primary/20"
                              >
                                Done
                              </button>
                            ) : null}
                            {onDeleteTask && task.status !== 'completed' && task.status !== 'skipped' ? (
                              <button
                                type="button"
                                aria-label="Delete task"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onDeleteTask(member.id, task.id);
                                }}
                                className="rounded-xl border border-border/60 p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {task.isMilestone || task.rewardText ? (
                          <div className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                            <div className="flex items-center gap-2 font-semibold">
                              <Sparkles className="h-3.5 w-3.5" />
                              Success milestone
                            </div>
                            {task.rewardText ? <div className="mt-1">{task.rewardText}</div> : null}
                          </div>
                        ) : null}

                        {celebrationTaskId === task.id ? (
                          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Completed
                            {task.rewardText ? ` - ${task.rewardText}` : ''}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {activeTask ? (
            <div className="mt-4 rounded-2xl border border-border/60 bg-card/50 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Current focus</div>
                  <div className="mt-1 text-sm font-semibold">{activeTask.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activeTask.source.replaceAll('_', ' ')} · {formatTaskTime(activeTask.dueAt)}
                  </div>
                </div>
                {(activeTask.isMilestone || activeTask.rewardText) ? (
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Gift className="h-3.5 w-3.5" />
                    {activeTask.rewardText || 'Success milestone'}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

export function TodayTimelineBoard({ members, timelinesByMemberId, onConfirmTask, onDeleteTask, onSelectTask, celebrationTaskId }: TodayTimelineBoardProps) {
  const active = members
    .map((member) => ({ member, data: timelinesByMemberId[member.id] }))
    .filter((item) => item.data?.settings.enabled);

  if (active.length === 0) {
    return (
      <section className="rounded-[30px] border border-border/60 bg-card/50 p-5">
        <h2 className="text-lg font-semibold">Today timeline</h2>
        <p className="mt-1 text-sm text-muted-foreground">No members have timeline enabled yet. Enable it in the Members settings tab.</p>
      </section>
    );
  }

  return (
    <section className="rounded-[30px] border border-border/60 bg-card/50 p-5">
      <h2 className="text-lg font-semibold">Today timeline</h2>
      <p className="mt-1 text-sm text-muted-foreground">The day moves left to right, tasks unlock at their due time, and milestones can carry their reward forward into completion.</p>
      <div className="mt-5 grid gap-5">
        {active.map(({ member, data }) => (
          <MemberTimelineLane
            key={member.id}
            member={member}
            data={data}
            onConfirmTask={onConfirmTask}
            onDeleteTask={onDeleteTask}
            onSelectTask={onSelectTask}
            celebrationTaskId={celebrationTaskId}
          />
        ))}
      </div>
    </section>
  );
}
