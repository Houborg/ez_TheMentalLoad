'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { Calendar, Entry, Member } from '@mental-load/contracts';
import { createEntry, updateEntry } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';
import { MobileEntryForm } from './mobile-entry-form';
import { entryToDraft, emptyDraft, draftToPayload } from './mobile-entry-draft';
import type { MobileEntryDraft } from './mobile-entry-draft';

type Props = {
  open: boolean;
  mode: 'create' | 'edit';
  entry?: Entry;
  initialDraft?: Partial<MobileEntryDraft>;
  members: Member[];
  calendars: Calendar[];
  onClose: () => void;
  onSaved: (entry: Entry) => void;
};

export function MobileEntrySheet({
  open,
  mode,
  entry,
  initialDraft,
  members,
  calendars,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<MobileEntryDraft>(() => buildInitialDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildInitialDraft(): MobileEntryDraft {
    if (mode === 'edit' && entry) {
      return entryToDraft(entry, members);
    }
    const base = emptyDraft(members[0]?.id ?? '', calendars[0]?.id ?? '');
    if (!initialDraft) return base;

    // When a calendar date was clicked, keep its local date but use the
    // "next full hour from now" time from base — then pin endTime to +1h.
    if (initialDraft.startTime) {
      const clicked = new Date(initialDraft.startTime);
      const start = new Date(base.startTime); // already next full hour from now
      start.setFullYear(clicked.getFullYear(), clicked.getMonth(), clicked.getDate());
      const end = new Date(start.getTime() + 3_600_000);
      return { ...base, ...initialDraft, startTime: start.toISOString(), endTime: end.toISOString() };
    }

    return { ...base, ...initialDraft };
  }

  // Re-initialize when the entry or mode changes (sheet opens for a different entry)
  useEffect(() => {
    if (!open) return;
    setDraft(buildInitialDraft());
    setError(null);
  }, [open, entry?.id, mode]);

  async function handleSave() {
    if (!draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload(draft);
      let saved: Entry;
      if (mode === 'edit' && entry) {
        saved = await updateEntry(entry.id, payload);
      } else {
        saved = await createEntry(payload);
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke gemme');
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'edit'
    ? (draft.type === 'task' ? 'Rediger opgave' : 'Rediger begivenhed')
    : (draft.type === 'task' ? 'Ny opgave' : 'Ny begivenhed');

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      expandable
      defaultExpanded
      ariaLabelledby="entry-sheet-title"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
        <h2 id="entry-sheet-title" className="font-semibold text-sm">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
          aria-label="Luk"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Form */}
      <div className="px-4 py-4">
        <MobileEntryForm
          draft={draft}
          onChange={patch => setDraft(d => ({ ...d, ...patch }))}
          members={members}
          calendars={calendars}
        />
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-card border-t border-border px-4 py-4 flex flex-col gap-2">
        {error && (
          <p className="text-xs text-destructive text-center">{error}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !draft.title.trim()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Gemmer…' : 'Gem'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-5 py-3 text-sm text-muted-foreground"
          >
            Annuller
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
