export type RecurrenceFreq = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type ReminderDraftMode = 'none' | '5' | '10' | '60' | '120' | '1440' | '2880' | 'custom';

export const REMINDER_OPTIONS_DA: Array<{ value: Exclude<ReminderDraftMode, 'custom'>; label: string }> = [
  { value: 'none', label: 'Ingen' },
  { value: '5', label: '5 min før' },
  { value: '10', label: '10 min før' },
  { value: '60', label: '1 time før' },
  { value: '120', label: '2 timer før' },
  { value: '1440', label: '1 dag før' },
  { value: '2880', label: '2 dage før' },
];

export const RECURRENCE_OPTIONS_DA: Array<{ value: RecurrenceFreq; label: string }> = [
  { value: 'none', label: 'Ingen' },
  { value: 'DAILY', label: 'Dagligt' },
  { value: 'WEEKLY', label: 'Ugentligt' },
  { value: 'MONTHLY', label: 'Månedligt' },
  { value: 'YEARLY', label: 'Årligt' },
];

export function parseRecurrenceRule(rule?: string): { freq: RecurrenceFreq; count: string } {
  if (!rule) return { freq: 'none', count: '' };
  const freqMatch = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  const countMatch = rule.match(/COUNT=(\d+)/);
  return {
    freq: (freqMatch?.[1] as RecurrenceFreq | undefined) ?? 'none',
    count: countMatch?.[1] ?? '',
  };
}

export function buildRecurrenceRule(freq: RecurrenceFreq, count: string): string | undefined {
  if (freq === 'none') return undefined;
  const countNum = Number(count);
  const countPart = Number.isFinite(countNum) && countNum > 0 ? `;COUNT=${countNum}` : '';
  return `FREQ=${freq}${countPart}`;
}

export function toReminderDraft(minutesBefore?: number): { mode: ReminderDraftMode; customHours: string } {
  if (!minutesBefore) return { mode: 'none', customHours: '' };
  const preset = REMINDER_OPTIONS_DA.find(o => o.value !== 'none' && Number(o.value) === minutesBefore);
  if (preset) return { mode: preset.value as ReminderDraftMode, customHours: '' };
  return { mode: 'custom', customHours: String(Number((minutesBefore / 60).toFixed(2))) };
}

export function toReminderPayload(
  mode: ReminderDraftMode,
  customHours: string,
): { minutesBefore: number } | null {
  if (mode === 'none') return null;
  if (mode === 'custom') {
    const hours = Number(customHours);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return { minutesBefore: Math.round(hours * 60) };
  }
  return { minutesBefore: Number(mode) };
}

/**
 * For recurring tasks, keep only the earliest occurrence per parent entry.
 * Events are returned unchanged — all occurrences belong on the calendar.
 *
 * Recurring occurrence IDs are formatted as "parentId:occurrenceDate".
 * parentEntryId may not be populated, so we extract the parent from the ID.
 */
export function deduplicateRecurringTasks<T extends { type: string; startTime: string; parentEntryId?: string; id: string }>(
  entries: T[],
): T[] {
  const seen = new Map<string, T>();
  const sorted = [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const entry of sorted) {
    if (entry.type !== 'task') continue;
    // Extract parent key: use parentEntryId, or the part of the ID before the first ':'
    const colonIdx = entry.id.indexOf(':');
    const key = entry.parentEntryId ?? (colonIdx >= 0 ? entry.id.slice(0, colonIdx) : entry.id);
    if (!seen.has(key)) seen.set(key, entry);
  }
  const keep = new Set(seen.values());
  return entries.filter(e => e.type !== 'task' || keep.has(e));
}

export function buildRemindersPayload(
  mode1: ReminderDraftMode,
  hours1: string,
  mode2: ReminderDraftMode,
  hours2: string,
): Array<{ minutesBefore: number }> {
  return [toReminderPayload(mode1, hours1), toReminderPayload(mode2, hours2)]
    .filter((r): r is { minutesBefore: number } => r !== null)
    .filter((r, i, arr) => arr.findIndex(c => c.minutesBefore === r.minutesBefore) === i);
}
