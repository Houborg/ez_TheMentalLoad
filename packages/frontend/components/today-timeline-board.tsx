'use client';

import { useEffect, useRef } from 'react';
import type { ListTodayMemberTimelineResponse, Member } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

type TodayTimelineBoardProps = {
  members: Member[];
  timelinesByMemberId: Record<string, ListTodayMemberTimelineResponse>;
  onConfirmTask: (memberId: string, taskId: string) => Promise<void>;
  celebrationTaskId?: string;
};

type TimelineVisualState = 'done' | 'active' | 'upcoming' | 'skipped';

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

function getSelectedTaskIndex(statuses: string[]) {
  const waitingIndex = statuses.findIndex((status) => status === 'waiting_confirmation');
  if (waitingIndex >= 0) {
    return waitingIndex;
  }

  const pendingIndex = statuses.findIndex((status) => status === 'pending');
  if (pendingIndex >= 0) {
    return pendingIndex;
  }

  const completedIndexes = statuses
    .map((status, index) => ({ status, index }))
    .filter((item) => item.status === 'completed');

  if (completedIndexes.length > 0) {
    return completedIndexes[completedIndexes.length - 1].index;
  }

  return 0;
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

// ── Horizontal geometry constants ──────────────────────────────────────────
const NODE_HALF = 25;   // radius of 50 px node
const SPACING   = 90;   // px between node centres horizontally
const START_X   = 70;   // left + right padding inside SVG
const CENTER_Y  = 120;  // vertical midline of the 240 px stage
const AMPLITUDE = 22;   // how far above/below midline nodes sit
const SVG_HEIGHT = 240; // fixed stage height in px

function buildWavePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const cx1 = prev.x + (current.x - prev.x) * 0.35;
    const cx2 = prev.x + (current.x - prev.x) * 0.65;
    path += ` C ${cx1} ${prev.y}, ${cx2} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

// ── Per-member strip (needs hooks → own component) ───────────────────────────
type MemberTimelineStripProps = {
  member: Member;
  data: ListTodayMemberTimelineResponse;
  onConfirmTask: (memberId: string, taskId: string) => Promise<void>;
  celebrationTaskId?: string;
};

function MemberTimelineStrip({ member, data, onConfirmTask, celebrationTaskId }: MemberTimelineStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const tasks = data.timeline.tasks ?? [];
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const selectedTaskIndex = getSelectedTaskIndex(tasks.map((t) => t.status));

  const points = tasks.map((task, index) => ({
    task,
    x: START_X + index * SPACING,
    y: CENTER_Y + (index % 2 === 0 ? -AMPLITUDE : AMPLITUDE),
  }));

  const selectedPoint = points[selectedTaskIndex] ?? points[0];
  const svgWidth = tasks.length > 0
    ? START_X + (tasks.length - 1) * SPACING + START_X
    : START_X * 2;
  const path = buildWavePath(points.map((p) => ({ x: p.x, y: p.y })));

  // Auto-scroll so the active node is horizontally centred in the container
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !selectedPoint) return;
    const targetLeft = selectedPoint.x - container.clientWidth / 2;
    container.scrollLeft = Math.max(0, targetLeft);
  }, [selectedPoint?.x]);

  return (
    <article className="timeline-shell rounded-2xl border border-border/60 bg-background/35 p-4">
      {/* header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{member.name}</div>
          <div className="text-xs text-muted-foreground">{tasks.length} tasks · {progress}% completed</div>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/70 px-4 py-6 text-sm text-muted-foreground">
          No tasks generated for this member today.
        </div>
      ) : (
        <>
          {/* horizontal scroll strip — NO vertical scroll */}
          <div className="timeline-scroll" ref={scrollRef}>
            <div className="timeline-stage" style={{ width: `${svgWidth}px` }}>
              <svg
                className="timeline-canvas"
                viewBox={`0 0 ${svgWidth} ${SVG_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`Timeline for ${member.name}`}
              >
                <defs>
                  <linearGradient
                    id={`timeline-track-${member.id}`}
                    gradientUnits="userSpaceOnUse"
                    x1="0" y1="0" x2={svgWidth} y2="0"
                  >
                    <stop offset="0%" stopColor="var(--timeline-cyan)" />
                    <stop offset="45%" stopColor="var(--timeline-magenta)" />
                    <stop offset="100%" stopColor="var(--timeline-amber)" />
                  </linearGradient>
                </defs>
                <path d={path} className="timeline-path timeline-path-muted" />
                <path d={path} className="timeline-path timeline-path-glow" style={{ stroke: `url(#timeline-track-${member.id})` }} />
              </svg>

              {points.map((point, index) => {
                const visualState = getVisualState(point.task.status);
                return (
                  <div
                    key={point.task.id}
                    className={cn(
                      'timeline-node',
                      visualState === 'done'     && 'timeline-node-done',
                      visualState === 'active'   && 'timeline-node-active',
                      visualState === 'upcoming' && 'timeline-node-upcoming',
                      visualState === 'skipped'  && 'timeline-node-skipped',
                      selectedTaskIndex === index && 'timeline-node-selected',
                    )}
                    style={{ left: `${point.x - NODE_HALF}px`, top: `${point.y - NODE_HALF}px` }}
                  >
                    <div className="timeline-node-inner">
                      {visualState === 'done' ? (
                        <span aria-hidden="true">✓</span>
                      ) : visualState === 'active' ? (
                        <button
                          type="button"
                          onClick={() => void onConfirmTask(member.id, point.task.id)}
                          className="timeline-node-button"
                          aria-label={`Confirm task ${point.task.title}`}
                        >
                          Confirm
                        </button>
                      ) : (
                        <span aria-hidden="true">🔒</span>
                      )}
                    </div>
                    <span className="timeline-pin" aria-hidden="true" />
                    <span className="timeline-tag">{point.task.position}. {point.task.title}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* callout bar — outside scroll so it's always fully visible */}
          {selectedPoint ? (
            <div className="timeline-callout-bar">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Current focus</div>
                  <div className="mt-0.5 truncate text-sm font-semibold">{selectedPoint.task.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {selectedPoint.task.source.replaceAll('_', ' ')} · {formatTaskTime(selectedPoint.task.dueAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn(
                    'rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em]',
                    selectedPoint.task.status === 'completed'           && 'bg-emerald-500/20 text-emerald-700',
                    selectedPoint.task.status === 'waiting_confirmation' && 'bg-amber-500/20 text-amber-700',
                    selectedPoint.task.status === 'pending'             && 'bg-blue-500/20 text-blue-700',
                    selectedPoint.task.status === 'skipped'             && 'bg-muted text-muted-foreground',
                  )}>
                    {selectedPoint.task.status.replace('_', ' ')}
                  </span>
                  {selectedPoint.task.status !== 'completed' ? (
                    <button
                      type="button"
                      onClick={() => void onConfirmTask(member.id, selectedPoint.task.id)}
                      className="rounded-lg border border-border/60 px-2 py-1 text-xs hover:bg-accent/60"
                    >
                      Done
                    </button>
                  ) : null}
                  {celebrationTaskId === selectedPoint.task.id ? <span className="text-base" aria-label="celebration">🎉</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

// ── Public board component ────────────────────────────────────────────────────
export function TodayTimelineBoard({ members, timelinesByMemberId, onConfirmTask, celebrationTaskId }: TodayTimelineBoardProps) {
  const active = members
    .map((member) => ({ member, data: timelinesByMemberId[member.id] }))
    .filter((item) => item.data?.settings.enabled);

  if (active.length === 0) {
    return (
      <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
        <h2 className="text-lg font-semibold">Today timeline</h2>
        <p className="mt-1 text-sm text-muted-foreground">No members have timeline enabled yet. Enable it in the Members settings tab.</p>
      </section>
    );
  }

  return (
    <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
      <h2 className="text-lg font-semibold">Today timeline</h2>
      <p className="mt-1 text-sm text-muted-foreground">Progress follows time and waits for confirmation at each due task.</p>
      <div className="mt-4 grid gap-4">
        {active.map(({ member, data }) => (
          <MemberTimelineStrip
            key={member.id}
            member={member}
            data={data}
            onConfirmTask={onConfirmTask}
            celebrationTaskId={celebrationTaskId}
          />
        ))}
      </div>
    </section>
  );
}
