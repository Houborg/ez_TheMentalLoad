'use client';

import { useEffect, useRef, useState } from 'react';
import type { Entry, Member } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

const START_HOUR = 7;
const END_HOUR = 23;
const NUM_HOURS = END_HOUR - START_HOUR;
const HOUR_HEIGHT = 64; // px per hour
const TOTAL_HEIGHT = HOUR_HEIGHT * NUM_HOURS;
const VISIBLE_HOURS = 7; // how many hours the container shows without scrolling
const CONTAINER_HEIGHT = VISIBLE_HOURS * HOUR_HEIGHT; // 448px

const HOURS = Array.from({ length: NUM_HOURS + 1 }, (_, i) => START_HOUR + i);

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function calcNowFraction(): number {
  const d = new Date();
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) / NUM_HOURS;
}

function formatTime(d: Date) {
  return d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
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
  /** Pass only TODAY's entries — TimeGrid uses time portion only, not date */
  entries: Entry[];
  aulaLessons?: AulaLesson[];
  onClickEntry?: (entry: Entry) => void;
};

export function TimeGrid({ members, memberColorById, entries, aulaLessons = [], onClickEntry }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [nowFrac, setNowFrac] = useState(() => calcNowFraction());
  const [nowTime, setNowTime] = useState(() => formatTime(new Date()));

  // Scroll so current time is visible near the top (1 hour padding above)
  useEffect(() => {
    if (!scrollRef.current || hasScrolled.current) return;
    const y = Math.max(0, nowFrac * TOTAL_HEIGHT - HOUR_HEIGHT);
    scrollRef.current.scrollTop = y;
    hasScrolled.current = true;
  }, []); // run once on mount

  // Update now indicator every minute
  useEffect(() => {
    const tick = () => {
      setNowFrac(calcNowFraction());
      setNowTime(formatTime(new Date()));
    };
    const id = setInterval(tick, 60_000);
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
      style={{ height: CONTAINER_HEIGHT }}
    >
      <div className="flex w-full" style={{ height: TOTAL_HEIGHT }}>

        {/* Time axis — w-10 to match header gutter */}
        <div className="relative w-10 shrink-0 border-r border-border/40">
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-0 pr-2 text-[10px] font-medium text-muted-foreground/50 leading-none tabular-nums"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT - 6 }}
            >
              {String(h).padStart(2, '0')}
            </div>
          ))}

          {/* Current time label on axis */}
          {inBounds && (
            <div
              className="absolute right-0 pr-1 text-[9px] font-bold text-red-500 leading-none tabular-nums z-30"
              style={{ top: nowY - 5 }}
            >
              {nowTime}
            </div>
          )}
        </div>

        {/* Member columns */}
        <div className="relative flex flex-1 min-w-0">

          {/* Hour grid lines */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute inset-x-0 border-t border-border/30"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}
            />
          ))}

          {/* Now line — across all columns */}
          {inBounds && (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
              style={{ top: nowY }}
            >
              <div className="h-3 w-3 shrink-0 rounded-full bg-red-500 shadow shadow-red-500/60 -ml-1.5" />
              <div className="h-0.5 flex-1 bg-red-500/80" />
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
                className={cn(
                  'relative min-w-0 flex-1',
                  i > 0 && 'border-l border-border/30',
                )}
                style={{ background: `${color}08` }}
              >
                {/* Aula school lessons — light striped, behind events */}
                {memberLessons.map((lesson, li) => {
                  if (!lesson.startTime || !lesson.endTime) return null;
                  const [sh = 0, sm = 0] = lesson.startTime.split(':').map(Number);
                  const [eh = 0, em = 0] = lesson.endTime.split(':').map(Number);
                  const startH = sh + sm / 60 - START_HOUR;
                  const endH = eh + em / 60 - START_HOUR;
                  if (endH <= 0 || startH >= NUM_HOURS) return null;
                  const top = Math.max(0, startH * HOUR_HEIGHT);
                  const height = Math.max(20, (endH - startH) * HOUR_HEIGHT);
                  return (
                    <div
                      key={`lesson-${li}`}
                      className="absolute inset-x-0.5 overflow-hidden rounded px-1.5 py-0.5 z-0"
                      style={{
                        top,
                        height,
                        background: `${color}18`,
                        borderLeft: `3px solid ${color}60`,
                      }}
                      title={`Skole: ${lesson.title}`}
                    >
                      <div className="text-[9px] font-semibold text-muted-foreground truncate">
                        📚 {lesson.title}
                      </div>
                    </div>
                  );
                })}

                {/* Calendar entries */}
                {memberEntries.map((entry) => {
                  const startD = new Date(entry.startTime);
                  const endD = new Date(entry.endTime);
                  const startH = startD.getHours() + startD.getMinutes() / 60 - START_HOUR;
                  const endH = endD.getHours() + endD.getMinutes() / 60 - START_HOUR;
                  if (endH <= 0 || startH >= NUM_HOURS) return null;
                  const top = Math.max(0, startH * HOUR_HEIGHT);
                  const height = Math.max(24, Math.min((endH - startH) * HOUR_HEIGHT, TOTAL_HEIGHT - top));
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      title={entry.title}
                      onClick={() => onClickEntry?.(entry)}
                      className="absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left text-white shadow-md hover:brightness-110 transition-[filter] z-10"
                      style={{
                        top,
                        height,
                        background: color + 'ee',
                        boxShadow: `0 2px 6px ${color}44`,
                      }}
                    >
                      <div className="truncate text-[10px] font-medium opacity-80">
                        {formatTime(startD)}
                      </div>
                      <div className="truncate text-[11px] font-bold leading-tight">{entry.title}</div>
                    </button>
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
