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

function storageKey(memberId: string) {
  return `member-section-visibility:${memberId}`;
}

export function useSectionVisibility(defaults: Record<SectionKey, boolean>, memberId: string) {
  const key = storageKey(memberId);

  const [visible, setVisible] = useState<Record<SectionKey, boolean>>(() => {
    if (typeof window === 'undefined') return defaults;
    try {
      const stored = localStorage.getItem(key);
      if (stored) return { ...defaults, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaults;
  });

  const toggle = useCallback((sectionKey: SectionKey) => {
    setVisible(prev => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  return { visible, toggle };
}
