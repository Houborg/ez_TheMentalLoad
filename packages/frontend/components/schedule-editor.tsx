'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Member, MemberScheduleEntry } from '@mental-load/contracts';
import {
  getMemberSchedule, createScheduleEntry, deleteScheduleEntry, updateMember,
} from '@/lib/api';

const DAY_LABELS = ['', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'] as const;

interface Props {
  member: Member;
  aulaConnected: boolean;
  onClose: () => void;
  onMemberUpdated: (m: Member) => void;
}

interface AddForm {
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  title: string;
  startTime: string;
  endTime: string;
  repeatDays: number[];
}

export function ScheduleEditor({ member, aulaConnected, onClose, onMemberUpdated }: Props) {
  const useAula = member.useAulaSchedule ?? true;
  const [entries, setEntries] = useState<MemberScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingDay, setAddingDay] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [form, setForm] = useState<AddForm>({ dayOfWeek: 1, title: '', startTime: '08:00', endTime: '09:00', repeatDays: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    getMemberSchedule(member.id)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [member.id]);

  const toggleAula = async () => {
    const next = !useAula;
    const updated = await updateMember(member.id, { useAulaSchedule: next });
    onMemberUpdated(updated);
  };

  const openAdd = (day: 1 | 2 | 3 | 4 | 5) => {
    setAddingDay(day);
    setForm({ dayOfWeek: day, title: '', startTime: '08:00', endTime: '09:00', repeatDays: [day] });
  };

  const saveEntry = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const days = form.repeatDays.length > 0 ? form.repeatDays : [form.dayOfWeek];
    const created: MemberScheduleEntry[] = [];
    for (const d of days as (1 | 2 | 3 | 4 | 5)[]) {
      const entry = await createScheduleEntry(member.id, {
        dayOfWeek: d,
        title: form.title.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
      });
      created.push(entry);
    }
    setEntries(prev => [...prev, ...created].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)));
    setAddingDay(null);
    setSaving(false);
  };

  const removeEntry = async (entryId: string) => {
    await deleteScheduleEntry(member.id, entryId);
    setEntries(prev => prev.filter(e => e.id !== entryId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-card p-5 pb-8 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-muted" />

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white"
            style={{ background: member.color ?? '#6d5efc' }}
          >
            {member.avatar ?? member.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="font-bold">{member.name} — Ugeskema</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Aula toggle */}
        <div className="mb-5 flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Brug Aula-data</div>
            <div className="text-xs text-muted-foreground">
              {aulaConnected ? 'Synkroniseret automatisk' : 'Aula ikke tilknyttet'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useAula}
            onClick={toggleAula}
            className={`relative h-6 w-11 rounded-full transition-colors ${useAula ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${useAula ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Schedule editor */}
        <div className={useAula ? 'pointer-events-none opacity-40' : ''}>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Manuelt ugeskema
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Henter…</p>
          ) : (
            <div className="space-y-3">
              {([1, 2, 3, 4, 5] as const).map(day => {
                const dayEntries = entries.filter(e => e.dayOfWeek === day);
                return (
                  <div key={day}>
                    <div className="mb-1 text-xs font-bold">{DAY_LABELS[day]}</div>
                    <div className="space-y-1">
                      {dayEntries.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                          <span className="flex-1 text-sm font-medium">{entry.title}</span>
                          <span className="text-xs text-muted-foreground">{entry.startTime}–{entry.endTime}</span>
                          <button type="button" onClick={() => removeEntry(entry.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}

                      {addingDay === day ? (
                        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
                          <div className="text-xs font-bold text-primary">Ny time — {DAY_LABELS[day]}</div>
                          <input
                            autoFocus
                            className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                            placeholder="Fagnavn"
                            value={form.title}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Start</div>
                              <input
                                type="time"
                                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                value={form.startTime}
                                onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                              />
                            </div>
                            <div className="flex-1">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Slut</div>
                              <input
                                type="time"
                                className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
                                value={form.endTime}
                                onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Gentag også</div>
                            <div className="flex gap-1.5">
                              {([1, 2, 3, 4, 5] as const).map(d => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setForm(f => ({
                                    ...f,
                                    repeatDays: f.repeatDays.includes(d)
                                      ? f.repeatDays.filter(x => x !== d)
                                      : [...f.repeatDays, d],
                                  }))}
                                  className={`rounded-full px-2 py-0.5 text-xs font-bold transition-colors ${
                                    form.repeatDays.includes(d)
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {['Man', 'Tir', 'Ons', 'Tor', 'Fre'][d - 1]}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAddingDay(null)}
                              className="flex-1 rounded-lg bg-muted py-2 text-sm"
                            >Annuller</button>
                            <button
                              type="button"
                              onClick={saveEntry}
                              disabled={saving || !form.title.trim()}
                              className="flex-[2] rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                            >Gem time</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAdd(day)}
                          className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
                        >
                          <Plus className="h-3 w-3" />
                          Tilføj time
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
