'use client';

import { CalendarDays, CheckCircle2, Clock3, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

const NAV_ITEMS: Array<{ key: NavSection; label: string; Icon: React.ElementType }> = [
  { key: 'dashboard', label: 'Hjem', Icon: CalendarDays },
  { key: 'planner', label: 'Planner', Icon: Clock3 },
  { key: 'timeline', label: 'I dag', Icon: CheckCircle2 },
  { key: 'family', label: 'Familie', Icon: Users },
  { key: 'settings', label: 'Indstil.', Icon: Settings },
];

type Props = {
  active: NavSection;
  onSelect: (section: NavSection) => void;
};

export function BottomNav({ active, onSelect }: Props) {
  return (
    <nav
      aria-label="Primary navigation"
      className="sticky bottom-0 z-20 flex shrink-0 items-stretch border-t border-border/50 bg-card/80 backdrop-blur"
    >
      {NAV_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          aria-label={label}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
            active === key
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
        </button>
      ))}
    </nav>
  );
}
