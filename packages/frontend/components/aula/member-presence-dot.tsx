'use client';

import type { AulaPresence } from '@mental-load/contracts';
import { visualFor } from './presence-colors';

interface Props {
  presence: AulaPresence | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

export function MemberPresenceDot({ presence, size = 'sm', className = '' }: Props) {
  const visual = visualFor(presence);
  if (!visual) return null;
  const dim = size === 'md' ? 'h-3 w-3' : 'h-2 w-2';
  return (
    <span
      title={presence?.statusLabel ?? visual.label}
      className={`inline-block rounded-full ring-2 ring-background ${dim} ${visual.dot} ${className}`}
    />
  );
}
