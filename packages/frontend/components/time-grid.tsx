'use client';

import { useEffect, useRef, useState } from 'react';
import type { Entry, Member } from '@mental-load/contracts';

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 64; // px per hour
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

function entryBelongsToMember(entry: Entry, memberId: string): boolean {
  return entry.ownerMemberId === memberId || (entry.visibleMemberIds?.includes(memberId) ?? false);
}

function timeToY(iso: string): number {
  const d = new Date(iso);
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) * HOUR_HEIGHT;
}

function durationPx(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(20, (ms / 3_600_000) * HOUR_HEIGHT);
}

function calcNowY(): number {
  const d = new Date();
  return (d.getHours() - START_HOUR + d.getMinutes() / 60) * HOUR_HEIGHT;
}

type Props = {
  members: Member[];
  memberColorById: Record<string, string>;
  entries: Entry[]; // today's events only
};

export function TimeGrid({ members, memberColorById, entries }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowY, setNowY] = useState(() => calcNowY());

  // Auto-scroll to now on mount
  useEffect(() => {
    const y = calcNowY();
    setNowY(y);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, y - scrollRef.current.clientHeight / 2);
    }
  }, []);

  // Update now-line every minute
  useEffect(() => {
    const id = setInterval(() => setNowY(calcNowY()), 60_000);
    return () => clearInterval(id);
  }, []);

  const TIME_COL_WIDTH = 36;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="flex" style={{ minHeight: TOTAL_HEIGHT }}>
        {/* Time axis */}
        <div style={{ width: TIME_COL_WIDTH, flexShrink: 0 }}>
          {HOURS.map((h) => (
            <div
              key={h}
              style={{ height: HOUR_HEIGHT }}
              className="flex items-start justify-end pr-2 pt-0.5 text-[10px] text-white/20"
            >
              {h}
            </div>
          ))}
        </div>

        {/* Member columns */}
        <div className="relative flex flex-1 gap-1 pr-2">
          {/* Hour grid lines */}
          {HOURS.map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute inset-x-0 border-t border-white/5"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}
            />
          ))}

          {/* Now line */}
          {nowY >= 0 && nowY <= TOTAL_HEIGHT && (
            <div
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: nowY }}
            >
              <div className="h-2 w-2 shrink-0 rounded-full bg-red-500" style={{ marginLeft: -4 }} />
              <div className="h-px flex-1 bg-red-500/60" />
            </div>
          )}

          {members.map((member) => {
            const color = memberColorById[member.id] ?? '#6366f1';
            const memberEntries = entries.filter((e) => entryBelongsToMember(e, member.id));
            return (
              <div key={member.id} className="relative flex-1 border-l border-white/4">
                {memberEntries.map((entry) => {
                  const top = timeToY(entry.startTime);
                  const height = durationPx(entry.startTime, entry.endTime);
                  if (top + height < 0 || top > TOTAL_HEIGHT) return null;
                  return (
                    <div
                      key={entry.id}
                      title={entry.title}
                      className="absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white/90"
                      style={{ top, height, background: color + 'cc' }}
                    >
                      <div className="truncate leading-tight">
                        {new Date(entry.startTime).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="truncate leading-tight">{entry.title}</div>
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
