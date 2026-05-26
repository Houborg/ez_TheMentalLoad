'use client';

import { MapPin, Plus, Trash2, RefreshCw, Bell, User } from 'lucide-react';
import type { Calendar, Member } from '@mental-load/contracts';
import type { MobileEntryDraft, MobileChecklistItem, MobileInvitee } from './mobile-entry-draft';
import { REMINDER_OPTIONS_DA, RECURRENCE_OPTIONS_DA, WEEKDAY_OPTIONS } from '@/lib/entry-utils';
import { cn } from '@/lib/utils';

type Props = {
  draft: MobileEntryDraft;
  onChange: (patch: Partial<MobileEntryDraft>) => void;
  members: Member[];
  calendars: Calendar[];
};

const INPUT_CLS =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const SELECT_CLS =
  'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const SECTION_LABEL_CLS = 'text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5';

function toDateInput(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toTimeInput(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function applyDateToISO(currentISO: string, dateValue: string): string {
  const base = currentISO ? new Date(currentISO) : new Date();
  const [y, m, d] = dateValue.split('-').map(Number);
  base.setFullYear(y, m - 1, d);
  return base.toISOString();
}

function applyTimeToISO(currentISO: string, timeValue: string): string {
  const base = currentISO ? new Date(currentISO) : new Date();
  const [h, min] = timeValue.split(':').map(Number);
  base.setHours(h, min, 0, 0);
  return base.toISOString();
}

export function MobileEntryForm({ draft, onChange, members, calendars }: Props) {
  function patchChecklist(index: number, patch: Partial<MobileChecklistItem>) {
    const next = draft.checklist.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange({ checklist: next });
  }

  function removeChecklist(index: number) {
    onChange({ checklist: draft.checklist.filter((_, i) => i !== index) });
  }

  function addChecklist() {
    onChange({ checklist: [...draft.checklist, { text: '', isCompleted: false }] });
  }

  function patchInvitee(index: number, patch: Partial<MobileInvitee>) {
    const next = draft.invitees.map((inv, i) => (i === index ? { ...inv, ...patch } : inv));
    onChange({ invitees: next });
  }

  function removeInvitee(index: number) {
    onChange({ invitees: draft.invitees.filter((_, i) => i !== index) });
  }

  function addInvitee() {
    onChange({ invitees: [...draft.invitees, { type: 'email', email: '' }] });
  }

  return (
    <div className="flex flex-col gap-5 pb-2">
      {/* ── Title ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Titel</p>
        <input
          autoFocus
          value={draft.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Hvad sker der?"
          className={INPUT_CLS}
        />
      </div>

      {/* ── Type ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Type</p>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['event', 'task'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ type: t })}
              className={cn(
                'flex-1 py-2.5 text-sm font-medium transition-colors',
                draft.type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground',
              )}
            >
              {t === 'event' ? 'Begivenhed' : 'Opgave'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Date & Time ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className={cn(SECTION_LABEL_CLS, 'mb-0')}>Tidspunkt</p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={e => onChange({ allDay: e.target.checked })}
              className="rounded"
            />
            Hele dagen
          </label>
        </div>
        <div className="flex gap-2 items-center">
          <span className="w-10 shrink-0 text-xs text-muted-foreground">Start</span>
          <input
            type="date"
            value={toDateInput(draft.startTime)}
            onChange={e => {
              if (!e.target.value) return;
              const newStart = applyDateToISO(draft.startTime, e.target.value);
              const newEnd = applyDateToISO(draft.endTime, e.target.value);
              onChange({ startTime: newStart, endTime: newEnd });
            }}
            className={cn(INPUT_CLS, 'flex-1')}
          />
          {!draft.allDay && (
            <input
              type="time"
              value={toTimeInput(draft.startTime)}
              onChange={e => {
                if (!e.target.value) return;
                onChange({ startTime: applyTimeToISO(draft.startTime, e.target.value) });
              }}
              className={cn(INPUT_CLS, 'flex-1')}
            />
          )}
        </div>
        {!draft.allDay && (
          <div className="flex gap-2 mt-2 items-center">
            <span className="w-10 shrink-0 text-xs text-muted-foreground">Slut</span>
            <input
              type="date"
              value={toDateInput(draft.endTime)}
              onChange={e => {
                if (!e.target.value) return;
                onChange({ endTime: applyDateToISO(draft.endTime, e.target.value) });
              }}
              className={cn(INPUT_CLS, 'flex-1')}
            />
            <input
              type="time"
              value={toTimeInput(draft.endTime)}
              onChange={e => {
                if (!e.target.value) return;
                onChange({ endTime: applyTimeToISO(draft.endTime, e.target.value) });
              }}
              className={cn(INPUT_CLS, 'flex-1')}
            />
          </div>
        )}
      </div>

      {/* ── Participants ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Deltagere</p>
        <div className="flex gap-2 flex-wrap">
          {members.map(m => {
            const checked = draft.visibleMemberIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  const next = checked
                    ? draft.visibleMemberIds.filter(id => id !== m.id)
                    : [...draft.visibleMemberIds, m.id];
                  const newOwner = next[0] ?? '';
                  const familyCal = calendars.find(c => !c.ownerMemberId);
                  const memberCal = calendars.find(c => c.ownerMemberId === newOwner);
                  const newCalendar = next.length > 1 && familyCal ? familyCal.id : (memberCal?.id ?? draft.calendarId);
                  onChange({ visibleMemberIds: next, ownerMemberId: newOwner, calendarId: newCalendar });
                }}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition-all',
                  checked
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'bg-muted text-muted-foreground',
                )}
                title={m.name}
              >
                {m.avatar ?? m.name[0]}
              </button>
            );
          })}
        </div>
        {draft.visibleMemberIds.length > 1 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Ejer: {members.find(m => m.id === draft.ownerMemberId)?.name ?? '—'}
          </p>
        )}
      </div>

      {/* ── Calendar ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Kalender</p>
        <div className="relative">
          <select
            value={draft.calendarId}
            onChange={e => onChange({ calendarId: e.target.value })}
            className={SELECT_CLS}
          >
            {calendars.map(cal => (
              <option key={cal.id} value={cal.id}>{cal.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Location ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Lokation</p>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={draft.location}
            onChange={e => onChange({ location: e.target.value })}
            placeholder="Tilføj lokation"
            className={cn(INPUT_CLS, 'pl-9')}
          />
        </div>
      </div>

      {/* ── Recurrence ── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          <p className={cn(SECTION_LABEL_CLS, 'mb-0')}>Gentagelse</p>
        </div>
        <select
          value={draft.recurrenceFreq}
          onChange={e => onChange({ recurrenceFreq: e.target.value as MobileEntryDraft['recurrenceFreq'] })}
          className={SELECT_CLS}
        >
          {RECURRENCE_OPTIONS_DA.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {draft.recurrenceFreq === 'WEEKLY' && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-1.5">
              {([
                { label: 'Hverdage', days: ['MO', 'TU', 'WE', 'TH', 'FR'] },
                { label: 'Weekend', days: ['SA', 'SU'] },
              ] as const).map(({ label, days }) => {
                const allActive = days.every(d => draft.recurrenceDays.includes(d));
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      const next = allActive
                        ? draft.recurrenceDays.filter(d => !(days as readonly string[]).includes(d))
                        : [...new Set([...draft.recurrenceDays, ...days])];
                      onChange({ recurrenceDays: next });
                    }}
                    className={cn(
                      'h-8 px-3 rounded-lg text-xs font-semibold transition-colors',
                      allActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAY_OPTIONS.map(({ code, label }) => {
                const active = draft.recurrenceDays.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? draft.recurrenceDays.filter(d => d !== code)
                        : [...draft.recurrenceDays, code];
                      onChange({ recurrenceDays: next });
                    }}
                    className={cn(
                      'h-8 w-10 rounded-lg text-xs font-semibold transition-colors',
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {draft.recurrenceFreq !== 'none' && (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number"
              min={1}
              value={draft.recurrenceCount}
              onChange={e => onChange({ recurrenceCount: e.target.value })}
              placeholder="Antal gange (ubegrænset)"
              className={cn(INPUT_CLS)}
            />
          </div>
        )}
      </div>

      {/* ── Reminders ── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          <p className={cn(SECTION_LABEL_CLS, 'mb-0')}>Påmindelser</p>
        </div>
        <div className="flex flex-col gap-2">
          {/* Reminder 1 */}
          <div className="flex gap-2">
            <select
              value={draft.reminder1Mode}
              onChange={e => onChange({ reminder1Mode: e.target.value as MobileEntryDraft['reminder1Mode'] })}
              className={cn(SELECT_CLS, 'flex-1')}
            >
              {REMINDER_OPTIONS_DA.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              <option value="custom">Brugerdefineret</option>
            </select>
            {draft.reminder1Mode === 'custom' && (
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={draft.reminder1CustomHours}
                onChange={e => onChange({ reminder1CustomHours: e.target.value })}
                placeholder="Timer"
                className={cn(INPUT_CLS, 'w-24')}
              />
            )}
          </div>
          {/* Reminder 2 */}
          <div className="flex gap-2">
            <select
              value={draft.reminder2Mode}
              onChange={e => onChange({ reminder2Mode: e.target.value as MobileEntryDraft['reminder2Mode'] })}
              className={cn(SELECT_CLS, 'flex-1')}
            >
              {REMINDER_OPTIONS_DA.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              <option value="custom">Brugerdefineret</option>
            </select>
            {draft.reminder2Mode === 'custom' && (
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={draft.reminder2CustomHours}
                onChange={e => onChange({ reminder2CustomHours: e.target.value })}
                placeholder="Timer"
                className={cn(INPUT_CLS, 'w-24')}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Checklist ── */}
      <div>
        <p className={SECTION_LABEL_CLS}>Tjekliste</p>
        <div className="flex flex-col gap-2">
          {draft.checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={item.text}
                onChange={e => patchChecklist(i, { text: e.target.value })}
                placeholder={`Punkt ${i + 1}`}
                className={cn(INPUT_CLS, 'flex-1')}
              />
              {/* Member assign */}
              <select
                value={item.assignedToMemberId ?? ''}
                onChange={e => patchChecklist(i, { assignedToMemberId: e.target.value || undefined })}
                className="rounded-xl border border-border bg-background px-2 py-2.5 text-sm outline-none focus:border-primary"
                aria-label="Tildel til"
              >
                <option value="">—</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name[0]}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeChecklist(i)}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-destructive"
                aria-label="Fjern punkt"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addChecklist}
            className="flex items-center gap-2 text-sm text-primary py-1"
          >
            <Plus className="h-4 w-4" />
            Tilføj punkt
          </button>
        </div>
      </div>

      {/* ── Invitees ── */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <p className={cn(SECTION_LABEL_CLS, 'mb-0')}>Inviterede</p>
        </div>
        <div className="flex flex-col gap-2">
          {draft.invitees.map((inv, i) => (
            <div key={i} className="flex items-center gap-2">
              {inv.type === 'member' ? (
                <select
                  value={inv.id ?? ''}
                  onChange={e => {
                    const member = members.find(m => m.id === e.target.value);
                    patchInvitee(i, {
                      id: member?.id,
                      email: member?.email ?? '',
                      type: 'member',
                    });
                  }}
                  className={cn(SELECT_CLS, 'flex-1')}
                >
                  <option value="">Vælg person</option>
                  {members.filter(m => m.email).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="email"
                  value={inv.email}
                  onChange={e => patchInvitee(i, { email: e.target.value })}
                  placeholder="Email"
                  className={cn(INPUT_CLS, 'flex-1')}
                />
              )}
              <button
                type="button"
                onClick={() => patchInvitee(i, { type: inv.type === 'member' ? 'email' : 'member', id: undefined, email: '' })}
                className="text-xs text-muted-foreground px-2 py-2.5 border border-border rounded-xl whitespace-nowrap"
              >
                {inv.type === 'member' ? 'Email' : 'Person'}
              </button>
              <button
                type="button"
                onClick={() => removeInvitee(i)}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-destructive"
                aria-label="Fjern"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addInvitee}
            className="flex items-center gap-2 text-sm text-primary py-1"
          >
            <Plus className="h-4 w-4" />
            Tilføj inviteret
          </button>
        </div>
      </div>
    </div>
  );
}
