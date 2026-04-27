'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Trash2, X } from 'lucide-react';
import type { Entry } from '@mental-load/contracts';

type EntryDetailsPopupProps = {
  entry: Entry;
  ownerName?: string;
  onClose: () => void;
  onSave: (patch: Partial<Entry>) => Promise<void>;
  onDelete: () => Promise<void>;
};

type EntryDraft = {
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  allDay: boolean;
  status: Entry['status'];
};

export function EntryDetailsPopup({ entry, ownerName, onClose, onSave, onDelete }: EntryDetailsPopupProps) {
  const [draft, setDraft] = useState<EntryDraft>(() => buildDraft(entry));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    setDraft(buildDraft(entry));
    setErrorText('');
    setSaving(false);
    setDeleting(false);
  }, [entry]);

  async function handleSave() {
    try {
      setSaving(true);
      setErrorText('');
      await onSave({
        title: draft.title.trim(),
        startTime: fromLocalInputValue(draft.startTime),
        endTime: fromLocalInputValue(draft.endTime),
        location: draft.location.trim() || undefined,
        allDay: draft.allDay,
        status: draft.status,
      });
      onClose();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update entry');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      setDeleting(true);
      setErrorText('');
      await onDelete();
      onClose();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete entry');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-xl rounded-[32px] border border-border/60 bg-card/95 p-6 shadow-2xl shadow-black/30">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{entry.type === 'task' ? 'Task details' : 'Event details'}</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {entry.type} {ownerName ? `· ${ownerName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-xl border border-border/60 p-2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorText ? (
          <div className="mb-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">{errorText}</div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
              required
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Start</span>
              <input
                type="datetime-local"
                value={draft.startTime}
                onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">End</span>
              <input
                type="datetime-local"
                value={draft.endTime}
                onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Status</span>
              <select
                value={draft.status}
                onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as Entry['status'] }))}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
              >
                <option value="scheduled">Scheduled</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Location</span>
              <input
                value={draft.location}
                onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) => setDraft((current) => ({ ...current, allDay: event.target.checked }))}
              className="h-4 w-4 rounded border-border/60"
            />
            All day
          </label>

          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-60"
            >
              {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function buildDraft(entry: Entry): EntryDraft {
  return {
    title: entry.title,
    startTime: toLocalInputValue(new Date(entry.startTime)),
    endTime: toLocalInputValue(new Date(entry.endTime)),
    location: entry.location ?? '',
    allDay: entry.allDay,
    status: entry.status,
  };
}

function toLocalInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}
