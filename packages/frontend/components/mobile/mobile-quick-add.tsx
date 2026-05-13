'use client';

import { useState } from 'react';
import { Sparkles, Send, Loader2, ChevronRight } from 'lucide-react';
import type { AssistantDraft, Calendar, Entry, Member } from '@mental-load/contracts';
import { parseAssistant, confirmAssistant, createEntry } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';
import { cn } from '@/lib/utils';

type Stage = 'ai' | 'quick';

type Props = {
  open: boolean;
  onClose: () => void;
  members: Member[];
  calendars: Calendar[];
  onCreated: (entry: Entry) => void;
  onOpenFull: (draft?: Partial<AssistantDraft>) => void;
};

function formatDate(iso?: string): string {
  if (!iso) return 'Dato';
  const d = new Date(iso);
  return d.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(iso?: string): string {
  if (!iso) return 'Tid';
  const d = new Date(iso);
  return d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

export function MobileQuickAdd({ open, onClose, members, calendars, onCreated, onOpenFull }: Props) {
  const [stage, setStage] = useState<Stage>('ai');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const defaultMember = members[0];
  const defaultCalendar = calendars[0];

  function handleClose() {
    setText('');
    setDraft(null);
    setStage('ai');
    setParseError(null);
    onClose();
  }

  async function handleParse() {
    if (!text.trim() || !defaultMember || !defaultCalendar) return;
    setParsing(true);
    setParseError(null);
    try {
      const res = await parseAssistant({
        message: text.trim(),
        memberId: defaultMember.id,
        calendarId: defaultCalendar.id,
      });
      setDraft(res.draft);
      setStage('quick');
    } catch {
      setParseError('Kunne ikke fortolke teksten. Udfyld manuelt.');
      setDraft(null);
      setStage('quick');
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!draft?.title.trim()) return;
    setSaving(true);
    try {
      let entry: Entry;
      // If the draft came from a successful AI parse, confirm via confirmAssistant.
      // Otherwise create directly via createEntry.
      if (draft && !parseError) {
        entry = await confirmAssistant({ draft });
      } else {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        entry = await createEntry({
          title: draft.title,
          type: draft.type,
          ownerMemberId: draft.ownerMemberId,
          calendarId: draft.calendarId,
          startTime: draft.startTime ?? now.toISOString(),
          endTime: draft.endTime ?? oneHourLater.toISOString(),
          timezone: draft.timezone,
          allDay: draft.allDay,
        });
      }
      onCreated(entry);
      handleClose();
    } finally {
      setSaving(false);
    }
  }

  const activeOwnerMemberId = draft?.ownerMemberId ?? defaultMember?.id;

  return (
    <BottomSheet open={open} onClose={handleClose} ariaLabelledby="quick-add-title">
      <div className="px-4 pb-8 pt-2">
        {stage === 'ai' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 id="quick-add-title" className="font-semibold text-sm">Tilføj hurtigt</h2>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Skriv hvad der skal ske — fx &ldquo;Tandlæge fredag kl 14 med Lars&rdquo;
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleParse()}
                placeholder="Hvad sker der?"
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleParse}
                disabled={!text.trim() || parsing}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
              >
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStage('quick')}
              className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"
            >
              Udfyld manuelt <ChevronRight className="h-3 w-3" />
            </button>
          </>
        )}

        {stage === 'quick' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 id="quick-add-title" className="font-semibold text-sm">
                {draft?.title ? draft.title : 'Ny begivenhed'}
              </h2>
              {parseError && <span className="text-xs text-destructive">{parseError}</span>}
            </div>

            {/* Title input */}
            <input
              autoFocus
              value={draft?.title ?? ''}
              onChange={e => setDraft(d => {
                const base: AssistantDraft = d ?? {
                  type: 'event',
                  title: '',
                  ownerMemberId: defaultMember?.id ?? '',
                  calendarId: defaultCalendar?.id ?? '',
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  allDay: false,
                  reminders: [],
                };
                return { ...base, title: e.target.value };
              })}
              placeholder="Titel"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary mb-3"
            />

            {/* Date + time display pills */}
            <div className="flex gap-2 mb-3">
              <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                📅 {formatDate(draft?.startTime)}
              </div>
              <div className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
                🕐 {formatTime(draft?.startTime)}
              </div>
            </div>

            {/* Member avatar selector */}
            <div className="flex gap-2 mb-4">
              {members.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft(d => {
                    const base: AssistantDraft = d ?? {
                      type: 'event',
                      title: '',
                      ownerMemberId: m.id,
                      calendarId: defaultCalendar?.id ?? '',
                      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      allDay: false,
                      reminders: [],
                    };
                    return { ...base, ownerMemberId: m.id };
                  })}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                    activeOwnerMemberId === m.id
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {m.name[0]}
                </button>
              ))}
            </div>

            {/* Save + Mere buttons */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!draft?.title.trim() || saving}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {saving ? 'Gemmer…' : 'Gem'}
              </button>
              <button
                type="button"
                onClick={() => onOpenFull(draft ?? undefined)}
                className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground"
              >
                Mere
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStage('ai')}
              className="mt-2 w-full text-center text-xs text-muted-foreground py-1"
            >
              ← Skriv igen
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
