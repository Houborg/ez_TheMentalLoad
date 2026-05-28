'use client';

import { useState } from 'react';
import { ChevronDown, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AulaPresence, Entry, Member, TodayMemberTimeline } from '@mental-load/contracts';

// ── Presence helpers ──────────────────────────────────────────────────────────

type PresenceStatus = 'present' | 'work' | 'school' | 'offline';

function resolvePresence(
  presence: AulaPresence | undefined,
  member: Member,
): { status: PresenceStatus; label: string } {
  if (!presence) {
    return { status: 'offline', label: member.role === 'child' ? '⚫ Status ukendt' : '⚫ Status ukendt' };
  }
  const s = presence.status;
  if (s === 'tilstede') return { status: 'present', label: '🟢 Tilstede' };
  if (s === 'ikke_ankommet') return { status: 'school', label: '🟣 I skole' };
  if (s === 'hentet') return { status: 'present', label: '🟢 Hentet' };
  if (s === 'syg') return { status: 'offline', label: '🔴 Syg' };
  if (s === 'ferie') return { status: 'offline', label: '⛱ Ferie' };
  return { status: 'offline', label: String(s) };
}

const PRESENCE_DOT_CLASS: Record<PresenceStatus, string> = {
  present: 'bg-green-500',
  work:    'bg-amber-400',
  school:  'bg-violet-500',
  offline: 'bg-gray-300',
};

// ── Task builder ──────────────────────────────────────────────────────────────

type TaskItem = {
  id: string;
  title: string;
  time?: string;
  done: boolean;
  reward?: string;
};

function buildTasksForMember(
  member: Member,
  entries: Entry[],
  timeline: TodayMemberTimeline | undefined,
): TaskItem[] {
  const tasks: TaskItem[] = [];

  // 1. From daily timeline (routine tasks)
  if (timeline) {
    for (const task of timeline.tasks) {
      if (task.status === 'skipped') continue;
      tasks.push({
        id: task.id,
        title: task.title,
        time: task.dueAt
          ? new Date(task.dueAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
          : undefined,
        done: task.status === 'completed',
        reward: task.rewardText ?? undefined,
      });
    }
  }

  // 2. From entry checklists assigned to this member (today's entries only)
  const todayStr = new Date().toISOString().slice(0, 10);
  for (const entry of entries) {
    const entryDate = new Date(entry.startTime).toISOString().slice(0, 10);
    if (entryDate !== todayStr) continue;
    if (entry.ownerMemberId !== member.id && entry.assignedToMemberId !== member.id) continue;
    for (const item of entry.checklist) {
      if (item.assignedToMemberId && item.assignedToMemberId !== member.id) continue;
      tasks.push({
        id: `${entry.id}-${item.id}`,
        title: item.text,
        done: item.isCompleted,
      });
    }
  }

  return tasks;
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  presenceByMemberId: Record<string, AulaPresence>;
  entries: Entry[];
  timelinesByMemberId: Record<string, { timeline: TodayMemberTimeline }>;
  onAddMember: () => void;
  onNavigateToMember: (memberId: string) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FamilieView({
  members,
  memberColorById,
  presenceByMemberId,
  entries,
  timelinesByMemberId,
  onAddMember,
  onNavigateToMember,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 p-3">
      {members.map((member) => {
        const color = memberColorById[member.id] ?? '#6d5efc';
        const presence = presenceByMemberId[member.id];
        const { label: presenceLabel, status: presenceStatus } = resolvePresence(presence, member);
        const isExpanded = expandedId === member.id;
        const timelineData = timelinesByMemberId[member.id];
        const tasks = buildTasksForMember(member, entries, timelineData?.timeline);
        const doneCount = tasks.filter((t) => t.done).length;
        const progress = tasks.length > 0 ? doneCount / tasks.length : 0;

        // Next upcoming event (today or later)
        const todayStr = new Date().toISOString().slice(0, 10);
        const nextEvent = entries
          .filter(
            (e) =>
              e.ownerMemberId === member.id &&
              new Date(e.startTime).toISOString().slice(0, 10) >= todayStr,
          )
          .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];

        return (
          <div
            key={member.id}
            className={cn(
              'overflow-hidden rounded-xl border bg-card transition-shadow',
              isExpanded ? 'border-border shadow-sm' : 'border-border/70',
            )}
          >
            {/* Card header — click to expand/collapse */}
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
              onClick={() => setExpandedId(isExpanded ? null : member.id)}
              aria-expanded={isExpanded}
            >
              {/* Avatar with presence dot */}
              <div className="relative shrink-0">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-black text-white shadow-md"
                  style={{ background: color }}
                >
                  {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
                </div>
                <div
                  className={cn(
                    'absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card',
                    PRESENCE_DOT_CLASS[presenceStatus],
                  )}
                />
              </div>

              {/* Name + role + status */}
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-black text-foreground">{member.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {member.role === 'parent' ? 'Forælder' : 'Barn'}
                </div>
                <div className="mt-0.5 text-[10px] font-semibold">{presenceLabel}</div>
              </div>

              {/* Progress bar + chevron */}
              <div className="flex flex-col items-end gap-1.5">
                {tasks.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${progress * 100}%`, background: color }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {doneCount}/{tasks.length}
                    </span>
                  </div>
                )}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    isExpanded && 'rotate-180',
                  )}
                />
              </div>
            </button>

            {/* Expanded body */}
            {isExpanded && (
              <div
                className="border-t border-border/50 px-4 pb-4 pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Next event */}
                {nextEvent && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                    <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                    <div>
                      <div className="text-[9px] text-muted-foreground">Næste aftale</div>
                      <div className="text-[11px] font-bold">
                        {nextEvent.title}
                        {' · '}
                        {new Date(nextEvent.startTime).toLocaleTimeString('da-DK', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Task list */}
                <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  Opgaver i dag
                </div>

                {tasks.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">Ingen opgaver i dag.</p>
                ) : (
                  <div className="flex flex-col">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2.5 border-b border-border/30 py-2 last:border-b-0"
                      >
                        <div
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-bold transition-colors',
                            task.done
                              ? 'border-green-500 bg-green-500 text-white'
                              : 'border-muted-foreground/30',
                          )}
                        >
                          {task.done && '✓'}
                        </div>
                        <span
                          className={cn(
                            'flex-1 text-[11px]',
                            task.done && 'text-muted-foreground line-through',
                          )}
                        >
                          {task.title}
                        </span>
                        {task.time && (
                          <span className="text-[10px] text-muted-foreground">{task.time}</span>
                        )}
                        {task.reward && <span className="text-sm">{task.reward}</span>}
                      </div>
                    ))}

                    {/* Motivational hints */}
                    {tasks.length > 0 && doneCount === tasks.length && (
                      <div className="mt-2 text-center text-[11px] font-bold text-green-600">
                        🎉 Alle opgaver klaret!
                      </div>
                    )}
                    {tasks.length > 1 && doneCount === tasks.length - 1 && (
                      <div className="mt-2 text-center text-[11px] font-semibold text-primary">
                        🎉 Næsten i mål! 1 opgave tilbage
                      </div>
                    )}
                  </div>
                )}

                {/* Link to full member page */}
                <button
                  type="button"
                  onClick={() => onNavigateToMember(member.id)}
                  className="mt-3 w-full rounded-lg border border-border/60 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
                >
                  Åbn {member.name.split(' ')[0]}s side →
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add member */}
      <button
        type="button"
        onClick={onAddMember}
        className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/60 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
      >
        <UserPlus className="h-4 w-4" />
        Tilføj familiemedlem
      </button>
    </div>
  );
}
