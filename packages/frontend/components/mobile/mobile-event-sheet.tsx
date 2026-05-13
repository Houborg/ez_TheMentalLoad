'use client';

import { useState } from 'react';
import { Clock, MapPin, Bell, RefreshCw, Trash2, Edit2, Check } from 'lucide-react';
import type { Calendar as CalendarType, Entry, Member } from '@mental-load/contracts';
import { deleteEntry, updateEntry } from '@/lib/api';
import { BottomSheet } from './bottom-sheet';
import { formatTimeRange, MONTHS_DA } from '@/lib/calendar-utils';
import { cn } from '@/lib/utils';

type Props = {
  entry: Entry | null;
  members: Member[];
  calendars: CalendarType[];
  onClose: () => void;
  onEdit: (entry: Entry) => void;
  onDeleted: () => void;
};

export function MobileEventSheet({ entry, members, calendars, onClose, onEdit, onDeleted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!entry) return null;

  const calendar = calendars.find(c => c.id === entry.calendarId);
  const owner = members.find(m => m.id === entry.ownerMemberId);
  const color = calendar?.color ?? '#6d5efc';

  const startDate = new Date(entry.startTime);
  const dateLabel = `${startDate.getDate()}. ${MONTHS_DA[startDate.getMonth()]} ${startDate.getFullYear()}`;

  const currentEntry = entry;

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteEntry(currentEntry.id);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleTask(taskId: string, isCompleted: boolean) {
    const updatedChecklist = currentEntry.checklist.map(t =>
      t.id === taskId ? { ...t, isCompleted } : t
    );
    await updateEntry(currentEntry.id, { checklist: updatedChecklist.map(t => ({ text: t.text, isCompleted: t.isCompleted, assignedToMemberId: t.assignedToMemberId })) });
  }

  return (
    <BottomSheet open={!!entry} onClose={onClose} ariaLabelledby="event-sheet-title">
      <div className="px-4 pb-8 pt-2">
        {/* Title row */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
          <h2 id="event-sheet-title" className="text-xl font-bold flex-1 leading-tight">{entry.title}</h2>
        </div>

        {/* Detail rows */}
        <div className="flex flex-col gap-3 mb-5">
          <div className="flex items-start gap-3 text-sm">
            <Clock className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <div>
              <div>{dateLabel}</div>
              {!entry.allDay && <div className="text-muted-foreground">{formatTimeRange(entry.startTime, entry.endTime)}</div>}
            </div>
          </div>

          {entry.location && (
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{entry.location}</span>
            </div>
          )}

          {owner && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                {owner.name[0]}
              </div>
              <span>{owner.name}</span>
            </div>
          )}

          {entry.reminders.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <Bell className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>{entry.reminders[0].minutesBefore} min før</span>
            </div>
          )}

          {entry.recurrenceRule && (
            <div className="flex items-center gap-3 text-sm">
              <RefreshCw className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span>Gentages</span>
            </div>
          )}
        </div>

        {/* Inline checklist */}
        {entry.checklist.length > 0 && (
          <div className="mb-5 rounded-xl border border-border/60 divide-y divide-border/40">
            {entry.checklist.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => handleToggleTask(task.id, !task.isCompleted)}
                className="flex items-center gap-3 px-3 py-2.5 w-full text-left"
              >
                <div className={cn(
                  'h-4 w-4 rounded flex items-center justify-center border flex-shrink-0',
                  task.isCompleted ? 'bg-primary border-primary' : 'border-muted-foreground',
                )}>
                  {task.isCompleted && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
                <span className={cn('text-sm', task.isCompleted && 'line-through text-muted-foreground')}>
                  {task.text}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            <Edit2 className="h-4 w-4" />
            Rediger
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={confirmDelete ? 'Bekræft sletning af begivenhed' : 'Slet begivenhed'}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-medium transition-colors',
              confirmDelete
                ? 'bg-destructive text-destructive-foreground flex-1'
                : 'bg-destructive/10 text-destructive',
            )}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete ? 'Bekræft sletning' : ''}
          </button>
        </div>
        {confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="mt-2 w-full text-center text-sm text-muted-foreground py-1"
          >
            Annuller
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
