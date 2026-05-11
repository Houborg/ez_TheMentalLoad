'use client';

import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock3, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

type MobileNavProps = {
  activeSection: NavSection;
};

const NAV_ITEMS: Array<{ label: string; icon: typeof CalendarDays; key: NavSection; href: string }> = [
  { label: 'Home', icon: CalendarDays, key: 'dashboard', href: '/' },
  { label: 'Planner', icon: Clock3, key: 'planner', href: '/planner' },
  { label: 'Timeline', icon: CheckCircle2, key: 'timeline', href: '/?section=timeline' },
  { label: 'Family', icon: Users, key: 'family', href: '/?section=family' },
  { label: 'Settings', icon: Settings, key: 'settings', href: '/?section=settings' },
];

export function MobileNav({ activeSection }: MobileNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-sidebar-border bg-sidebar/95 backdrop-blur pb-safe md:hidden"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map(item => (
        <Link
          key={item.key}
          href={item.href}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium transition-colors min-h-[56px]',
            activeSection === item.key
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={item.label}
          aria-current={activeSection === item.key ? 'page' : undefined}
        >
          <item.icon className={cn('h-5 w-5', activeSection === item.key && 'text-primary')} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
