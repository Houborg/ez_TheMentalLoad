'use client';

import { useState } from 'react';
import type { AulaPresence } from '@mental-load/contracts';
import { visualFor } from './presence-colors';

interface Props {
  presence: AulaPresence | null | undefined;
}

export function MemberPresenceBadge({ presence }: Props) {
  const visual = visualFor(presence);
  const [open, setOpen] = useState(false);
  if (!visual || !presence) return null;

  const label = presence.statusLabel || visual.label;
  const asOfTime = new Date(presence.asOf).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${visual.pill}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${visual.dot}`} />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
          {presence.entryTime && <div>Kom kl. {presence.entryTime}</div>}
          {presence.exitTime && <div>Gik kl. {presence.exitTime}</div>}
          {presence.comment && <div className="mt-1 text-muted-foreground">{presence.comment}</div>}
          <div className="mt-1 text-muted-foreground">Opdateret kl. {asOfTime}</div>
        </div>
      )}
    </div>
  );
}
