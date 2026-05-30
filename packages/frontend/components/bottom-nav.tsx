'use client';

import { CalendarDays, Clock, ClipboardList, Users, Settings, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavSection = 'dashboard' | 'idag' | 'planner' | 'family' | 'ai' | 'settings';

const NAV_ITEMS: Array<{ key: NavSection; label: string; Icon: React.ElementType }> = [
  { key: 'dashboard', label: 'Hjem',     Icon: CalendarDays },
  { key: 'idag',      label: 'I dag',    Icon: Clock },
  { key: 'planner',   label: 'Planner',  Icon: ClipboardList },
  { key: 'family',    label: 'Familie',  Icon: Users },
  { key: 'ai',        label: 'AI',       Icon: Bot },
  { key: 'settings',  label: 'Indstil.', Icon: Settings },
];

type Props = {
  active: NavSection;
  onSelect: (section: NavSection) => void;
};

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary navigation"
      className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-border bg-card"
    >
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-label={label}
          aria-current={active === key ? 'page' : undefined}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-semibold transition-colors',
            active === key
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <div className={cn('rounded-lg p-1 transition-colors', active === key && 'bg-primary/10')}>
            <Icon className="h-5 w-5" />
          </div>
          {label}
        </button>
      ))}
    </nav>
  );
}
