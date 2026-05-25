'use client';

import { useCallback, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SectionKey = 'kalender' | 'ugenoter' | 'skoleskema' | 'lektier' | 'opgaver' | 'beskeder';

export interface SectionDef {
  key: SectionKey;
  label: string;
  Icon: LucideIcon;
}

interface Props {
  sections: SectionDef[];
  visible: Record<SectionKey, boolean>;
  onToggle: (key: SectionKey) => void;
}

export function MemberSectionToggle({ sections, visible, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {sections.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onToggle(key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors',
            visible[key]
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border/60 bg-card/60 text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

const STORAGE_KEY = 'member-section-visibility';

export function useSectionVisibility(defaults: Record<SectionKey, boolean>) {
  const [visible, setVisible] = useState<Record<SectionKey, boolean>>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...defaults, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaults;
  });

  const toggle = useCallback((key: SectionKey) => {
    setVisible(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { visible, toggle };
}
