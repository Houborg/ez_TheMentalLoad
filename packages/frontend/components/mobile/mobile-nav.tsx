'use client';

import { CalendarDays, CheckSquare, ChefHat, Clock, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MobileTab = 'kalender' | 'idag' | 'opgaver' | 'mad' | 'familie' | 'mere';

type MobileNavProps = {
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
};

const TABS: Array<{ key: MobileTab; label: string; Icon: LucideIcon }> = [
  { key: 'kalender', label: 'Kalender', Icon: CalendarDays },
  { key: 'idag',     label: 'I dag',    Icon: Clock },
  { key: 'opgaver',  label: 'Opgaver',  Icon: CheckSquare },
  { key: 'mad',      label: 'Mad',      Icon: ChefHat },
  { key: 'familie',  label: 'Familie',  Icon: Users },
];

export function MobileNav({ active, onSelect }: MobileNavProps) {
  return (
    <nav
      role="tablist"
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card/95 backdrop-blur pb-safe"
      aria-label="Mobilnavigation"
    >
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onSelect(key)}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-[11px] font-medium transition-colors',
            active === key ? 'text-primary' : 'text-muted-foreground',
          )}
          role="tab"
          aria-selected={active === key}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
