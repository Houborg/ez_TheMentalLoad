import type { AulaPresence } from '@mental-load/contracts';

export interface PresenceVisual {
  pill: string;   // background + text classes for the badge
  dot: string;    // solid background for the dot
  label: string;  // fallback label (used if statusLabel is missing)
}

export const PRESENCE_VISUAL: Record<string, PresenceVisual> = {
  tilstede:      { pill: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', dot: 'bg-emerald-500', label: 'Tilstede' },
  ikke_ankommet: { pill: 'bg-amber-500/15 text-amber-700 border-amber-500/30',       dot: 'bg-amber-500',   label: 'Ikke ankommet' },
  hentet:        { pill: 'bg-sky-500/15 text-sky-700 border-sky-500/30',             dot: 'bg-sky-500',     label: 'Hentet' },
  syg:           { pill: 'bg-rose-500/15 text-rose-700 border-rose-500/30',          dot: 'bg-rose-500',    label: 'Syg' },
  ferie:         { pill: 'bg-violet-500/15 text-violet-700 border-violet-500/30',    dot: 'bg-violet-500',  label: 'Ferie' },
  fri:           { pill: 'bg-slate-500/15 text-slate-700 border-slate-500/30',       dot: 'bg-slate-400',   label: 'Fri' },
};

export function visualFor(presence: AulaPresence | null | undefined): PresenceVisual | null {
  if (!presence) return null;
  return PRESENCE_VISUAL[presence.status] ?? {
    pill: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
    dot:  'bg-slate-400',
    label: presence.statusLabel || presence.status,
  };
}
