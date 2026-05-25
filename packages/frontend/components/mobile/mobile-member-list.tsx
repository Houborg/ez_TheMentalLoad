'use client';

import type { AulaPresence, Member } from '@mental-load/contracts';
import { MemberPresenceDot } from '@/components/aula/member-presence-dot';
import { ChevronRight } from 'lucide-react';

type Props = {
  members: Member[];
  presenceByMemberId?: Record<string, AulaPresence>;
  onSelectMember: (member: Member) => void;
};

export function MobileMemberList({ members, presenceByMemberId, onSelectMember }: Props) {
  const parents = members.filter(m => m.role === 'parent');
  const children = members.filter(m => m.role === 'child');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold">Familie</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{members.length} medlemmer</p>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-auto px-4 pb-24">
        {parents.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Forældre
            </div>
            <div className="flex flex-col gap-2">
              {parents.map(m => (
                <MemberCard
                  key={m.id}
                  member={m}
                  presence={presenceByMemberId?.[m.id]}
                  onSelect={() => onSelectMember(m)}
                />
              ))}
            </div>
          </div>
        )}

        {children.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Børn
            </div>
            <div className="flex flex-col gap-2">
              {children.map(m => (
                <MemberCard
                  key={m.id}
                  member={m}
                  presence={presenceByMemberId?.[m.id]}
                  onSelect={() => onSelectMember(m)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({ member, presence, onSelect }: {
  member: Member;
  presence: AulaPresence | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 text-left active:bg-accent/60 transition-colors"
    >
      {/* Avatar with presence dot */}
      <div className="relative flex-shrink-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-base font-semibold">
          {member.avatar || member.name[0]}
        </div>
        <MemberPresenceDot
          presence={presence ?? null}
          size="md"
          className="absolute -bottom-0.5 -right-0.5"
        />
      </div>

      {/* Name + role */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{member.name}</div>
        <div className="text-xs text-muted-foreground">
          {member.role === 'parent' ? 'Forælder' : 'Barn'}
          {member.email ? ` · ${member.email}` : ''}
        </div>
        {presence?.statusLabel && (
          <div className="text-xs text-primary mt-0.5">{presence.statusLabel}</div>
        )}
      </div>

      {/* Chevron */}
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}
