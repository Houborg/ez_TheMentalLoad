'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entry, Member } from '@mental-load/contracts';
import { cn } from '@/lib/utils';

const START_HOUR = 6;
const END_HOUR = 23;
const NUM_HOURS = END_HOUR - START_HOUR;
const HOURS = Array.from({ length: NUM_HOURS }, (_, i) => START_HOUR + i);
const MIN_HOUR_HEIGHT = 40;

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function calcNowFraction(): number {
  const d = new Date();
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) / NUM_HOURS;
}

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  entries: Entry[];
};

export function TimeGrid({ members, memberColorById, entries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [hourHeight, setHourHeight] = useState(MIN_HOUR_HEIGHT);
  const [nowFrac, setNowFrac] = useState(() => calcNowFraction());

  // Dynamically size rows to fill the container
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      setHourHeight(Math.max(MIN_HOUR_HEIGHT, Math.floor(h / NUM_HOURS)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll to center the now-line — only once after first real measurement
  useEffect(() => {
    if (!scrollRef.current || hasScrolled.current || hourHeight === MIN_HOUR_HEIGHT) return;
    const totalHeight = hourHeight * NUM_HOURS;
    const y = nowFrac * totalHeight;
    scrollRef.current.scrollTop = Math.max(0, y - scrollRef.current.clientHeight / 2);
    hasScrolled.current = true;
  }, [hourHeight]); // intentionally omit nowFrac — scroll once only

  // Update now-line every minute (without triggering scroll)
  useEffect(() => {
    const id = setInterval(() => setNowFrac(calcNowFraction()), 60_000);
    return () => clearInterval(id);
  }, []);

  const totalHeight = hourHeight * NUM_HOURS;
  const nowY = nowFrac * totalHeight;
  const inBounds = nowFrac >= 0 && nowFrac <= 1;
  const hasAnyEvents = entries.some((e) => !e.allDay);

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto">
        <div className="flex flex-1" style={{ height: totalHeight, minHeight: totalHeight }}>

          {/* Time axis */}
          <div className="relative shrink-0 w-10 border-r border-border">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-0 pr-2 text-[11px] font-medium text-muted-foreground/60 leading-none"
                style={{ top: (h - START_HOUR) * hourHeight - 6 }}
              >
                {h}
              </div>
            ))}
          </div>

          {/* Member columns */}
          <div className="relative flex flex-1">
            {/* Hour grid lines */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t border-border/40"
                style={{ top: (h - START_HOUR) * hourHeight }}
              />
            ))}

            {/* Empty state */}
            {!hasAnyEvents && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded-full border border-border bg-muted/50 px-4 py-2 text-[11px] text-muted-foreground/60">
                  Ingen begivenheder i dag
                </span>
              </div>
            )}

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
              const memberEntries = entries.filter((e) => entryBelongsToMember(e, member.id));
              return (
                <div
                  key={member.id}
                  className={cn('relative flex-1', i > 0 && 'border-l border-border/30')}
                  style={{
                    background: `${color}0a`,
                  }}
                >
                  {memberEntries.map((entry) => {
                    const startD = new Date(entry.startTime);
                    const topFrac = (startD.getHours() - START_HOUR + startD.getMinutes() / 60) / NUM_HOURS;
                    const durH = (new Date(entry.endTime).getTime() - startD.getTime()) / 3_600_000;
                    const heightFrac = Math.max(20 / totalHeight, durH / NUM_HOURS);
                    const top = topFrac * totalHeight;
                    const height = heightFrac * totalHeight;
                    if (top + height < 0 || top > totalHeight) return null;
                    return (
                      <div
                        key={entry.id}
                        title={entry.title}
                        className="absolute mx-1 overflow-hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
                        style={{
                          top,
                          height,
                          left: 0,
                          right: 0,
                          background: color + 'dd',
                          boxShadow: `0 2px 8px ${color}44`,
                        }}
                      >
                        <div className="truncate opacity-75 text-[10px]">
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
    </div>
  );
}
