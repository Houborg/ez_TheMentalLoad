'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Settings, Users } from 'lucide-react';
import type { AulaPresence, Member } from '@mental-load/contracts';
import { MemberPresenceDot } from '@/components/aula/member-presence-dot';
import { cn } from '@/lib/utils';

type SidebarSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

type AppSidebarProps = {
  activeSection: SidebarSection;
  members?: Member[];
  activeMemberId?: string;
  presenceByMemberId?: Record<string, AulaPresence>;
};

const NAV_ITEMS: Array<{ label: string; icon: typeof CalendarDays; key: SidebarSection; href: string }> = [
  { label: 'Dashboard', icon: CalendarDays, key: 'dashboard', href: '/' },
  { label: 'Planner', icon: Clock3, key: 'planner', href: '/planner' },
  { label: 'Timeline', icon: CheckCircle2, key: 'timeline', href: '/?section=timeline' },
  { label: 'Family', icon: Users, key: 'family', href: '/?section=family' },
  { label: 'Settings', icon: Settings, key: 'settings', href: '/?section=settings' },
];

const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

export function AppSidebar({ activeSection, members = [], activeMemberId, presenceByMemberId }: AppSidebarProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  return (
    <aside
      className={cn(
        'hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar/80 py-5 backdrop-blur transition-all duration-300 flex-col',
        isSidebarCollapsed ? 'w-20 px-2' : 'w-72 px-4',
      )}
    >
      <div className={cn('mb-5 flex items-center', isSidebarCollapsed ? 'flex-col gap-3' : 'gap-3')}>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <CalendarDays className="h-5 w-5" />
        </div>
        {!isSidebarCollapsed ? (
          <div>
            <div className="text-sm font-semibold tracking-tight">MentalLoad</div>
            <div className="text-xs text-muted-foreground">Refit frontend, stable backend</div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/55 text-muted-foreground transition hover:text-foreground',
            isSidebarCollapsed ? '' : 'ml-auto',
          )}
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="space-y-2" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              'flex w-full items-center rounded-2xl py-3 text-sm transition-colors',
              isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3',
              activeSection === item.key ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
            )}
            aria-label={item.label}
            title={isSidebarCollapsed ? item.label : undefined}
          >
            <item.icon className="h-4 w-4" />
            {!isSidebarCollapsed ? <span>{item.label}</span> : null}
          </Link>
        ))}
      </nav>

      {members.length > 0 ? (
        <div className="mt-8">
          {!isSidebarCollapsed ? <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Family members</div> : null}
          <div className="space-y-2">
            {members.map((member, index) => (
              <Link
                key={member.id}
                href={`/member/${encodeURIComponent(member.id)}`}
                className={cn(
                  'flex w-full rounded-2xl py-2.5 text-left hover:bg-sidebar-accent/60',
                  activeMemberId === member.id && 'bg-sidebar-accent/60',
                  isSidebarCollapsed ? 'justify-center px-1' : 'items-center gap-3 px-3',
                )}
                title={isSidebarCollapsed ? `${member.name} (${member.role})` : undefined}
              >
                <div className="relative shrink-0">
                  <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground', MEMBER_COLOR_CLASSES[index % MEMBER_COLOR_CLASSES.length])}>
                    {member.avatar ? <span className="text-xl">{member.avatar}</span> : <Users className="h-5 w-5" />}
                  </div>
                  <MemberPresenceDot
                    presence={presenceByMemberId?.[member.id]}
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </div>
                {!isSidebarCollapsed ? (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{member.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{member.role}</div>
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* Version badge */}
      <div className="mt-auto pt-6">
        {!isSidebarCollapsed ? (
          <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-2">
            <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-widest mb-0.5">Build</div>
            <div className="text-[11px] tabular-nums text-muted-foreground/60 leading-snug">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
              {process.env.NEXT_PUBLIC_APP_COMMIT !== 'local' ? (
                <span className="ml-1 opacity-60">({process.env.NEXT_PUBLIC_APP_COMMIT})</span>
              ) : (
                <span className="ml-1 opacity-60">(dev)</span>
              )}
            </div>
          </div>
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/40 bg-background/30 mx-auto"
            title={`v${process.env.NEXT_PUBLIC_APP_VERSION} (${process.env.NEXT_PUBLIC_APP_COMMIT})`}
          >
            <span className="text-[9px] font-bold text-muted-foreground/60 tabular-nums leading-none">
              {process.env.NEXT_PUBLIC_APP_VERSION?.split('.').slice(0, 2).join('.')}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
