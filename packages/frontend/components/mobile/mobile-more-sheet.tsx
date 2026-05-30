'use client';

import { Clock, Sparkles, Settings, Bot } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BottomSheet } from './bottom-sheet';

export type MoreSection = 'idag' | 'assistent' | 'indstillinger' | 'ai';

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate: (section: MoreSection) => void;
};

const TILES: Array<{ key: MoreSection; label: string; Icon: LucideIcon }> = [
  { key: 'idag',          label: 'I dag',         Icon: Clock },
  { key: 'ai',            label: 'AI-assistent',  Icon: Bot },
  { key: 'assistent',     label: 'Assistent',      Icon: Sparkles },
  { key: 'indstillinger', label: 'Indstillinger',  Icon: Settings },
];

export function MobileMoreSheet({ open, onClose, onNavigate }: Props) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabelledby="more-sheet-title">
      <div className="px-4 pb-8 pt-2">
        <h2 id="more-sheet-title" className="text-sm font-semibold text-muted-foreground mb-4">Mere</h2>
        <div className="grid grid-cols-2 gap-3">
          {TILES.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => { onNavigate(key); onClose(); }}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border/60 bg-card py-5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <Icon className="h-6 w-6 text-primary" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
