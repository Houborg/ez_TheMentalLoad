'use client';

import { useEffect, useRef, useState } from 'react';
import type { Entry, Member } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

const START_HOUR = 7;
const END_HOUR = 21;
const NUM_HOURS = END_HOUR - START_HOUR;
const HOUR_HEIGHT = 64; // px per hour — fixed, no ResizeObserver
const TOTAL_HEIGHT = HOUR_HEIGHT * NUM_HOURS;
const HOURS = Array.from({ length: NUM_HOURS + 1 }, (_, i) => START_HOUR + i);

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function calcNowFraction(): number {
  const d = new Date();
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) / NUM_HOURS;
}

export interface AulaLesson {
  memberId: string;
  title: string;
  date: string;        // YYYY-MM-DD
  startTime?: string;  // HH:MM
  endTime?: string;    // HH:MM
}

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  entries: Entry[];
  aulaLessons?: AulaLesson[];
};

export function TimeGrid({ members, memberColorById, entries, aulaLessons = [] }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [nowFrac, setNowFrac] = useState(() => calcNowFraction());

  // Auto-scroll so current time is ~2 hours from top
  useEffect(() => {
    if (!scrollRef.current || hasScrolled.current) return;
    const y = Math.max(0, (nowFrac * TOTAL_HEIGHT) - HOUR_HEIGHT * 2);
    scrollRef.current.scrollTop = y;
    hasScrolled.current = true;
  }, [nowFrac]);

  // Update now-line every minute
  useEffect(() => {
    const id = setInterval(() => setNowFrac(calcNowFraction()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowY = nowFrac * TOTAL_HEIGHT;
  const inBounds = nowFrac >= 0 && nowFrac <= 1;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayLessons = aulaLessons.filter((l) => l.date === todayStr);

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto"
      style={{ height: 500 }}
    >
      <div className="flex" style={{ height: TOTAL_HEIGHT, minHeight: TOTAL_HEIGHT }}>

        {/* Time axis */}
        <div className="relative shrink-0 w-10 border-r border-border/40">
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-0 pr-2 text-[10px] font-medium text-muted-foreground/50 leading-none"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT - 6 }}
            >
              {h < 10 ? `0${h}` : h}
            </div>
          ))}
        </div>

        {/* Columns */}
        <div className="relative flex flex-1 min-w-0">
          {/* Hour grid lines */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute inset-x-0 border-t border-border/30"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}
            />
          ))}

          {/* Now line */}
          {inBounds && (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
              style={{ top: nowY }}
            >
              <div className="ml-0 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-md shadow-red-500/50" />
              <div className="h-px flex-1 bg-red-500/70" />
            </div>
          )}

          {/* Member columns */}
          {members.map((member, i) => {
            const color = memberColorById[member.id] ?? '#6366f1';
            const memberEntries = entries.filter((e) => !e.allDay && entryBelongsToMember(e, member.id));
            const memberLessons = todayLessons.filter((l) => l.memberId === member.id);

            return (
              <div
                key={member.id}
                className={cn('relative min-w-0 flex-1 overflow-hidden', i > 0 && 'border-l border-border/30')}
                style={{ background: `${color}08` }}
              >
                {/* Aula school lessons — rendered as striped background blocks */}
                {memberLessons.map((lesson, li) => {
                  if (!lesson.startTime || !lesson.endTime) return null;
                  const [sh, sm] = lesson.startTime.split(':').map(Number);
                  const [eh, em] = lesson.endTime.split(':').map(Number);
                  const topFrac = (sh - START_HOUR + (sm ?? 0) / 60) / NUM_HOURS;
                  const durH = (eh + (em ?? 0) / 60) - (sh + (sm ?? 0) / 60);
                  const top = Math.max(0, topFrac * TOTAL_HEIGHT);
                  const height = Math.max(20, (durH / NUM_HOURS) * TOTAL_HEIGHT);
                  return (
                    <div
                      key={`lesson-${li}`}
                      className="absolute inset-x-0.5 overflow-hidden rounded px-1.5 py-0.5"
                      style={{
                        top,
                        height,
                        background: `${color}22`,
                        borderLeft: `3px solid ${color}88`,
                      }}
                      title={`Skole: ${lesson.title}`}
                    >
                      <div className="text-[9px] font-bold text-muted-foreground truncate">
                        📚 {lesson.title}
                      </div>
                    </div>
                  );
                })}

                {/* Calendar entries */}
                {memberEntries.map((entry) => {
                  const startD = new Date(entry.startTime);
                  const topFrac = (startD.getHours() - START_HOUR + startD.getMinutes() / 60) / NUM_HOURS;
                  const durH = (new Date(entry.endTime).getTime() - startD.getTime()) / 3_600_000;
                  const heightFrac = Math.max(22 / TOTAL_HEIGHT, durH / NUM_HOURS);
                  const top = topFrac * TOTAL_HEIGHT;
                  const height = heightFrac * TOTAL_HEIGHT;
                  if (top + height < 0 || top > TOTAL_HEIGHT) return null;
                  return (
                    <div
                      key={entry.id}
                      title={entry.title}
                      className="absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-white shadow-md"
                      style={{
                        top,
                        height,
                        background: color + 'ee',
                        boxShadow: `0 2px 6px ${color}44`,
                      }}
                    >
                      <div className="truncate opacity-80 text-[10px] font-medium">
                        {startD.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="truncate font-bold leading-tight">{entry.title}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
