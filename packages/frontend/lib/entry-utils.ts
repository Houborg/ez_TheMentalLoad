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

export const WEEKDAY_OPTIONS = [
  { code: 'MO', label: 'Man' },
  { code: 'TU', label: 'Tir' },
  { code: 'WE', label: 'Ons' },
  { code: 'TH', label: 'Tor' },
  { code: 'FR', label: 'Fre' },
  { code: 'SA', label: 'Lør' },
  { code: 'SU', label: 'Søn' },
] as const;

export function parseRecurrenceRule(rule?: string): { freq: RecurrenceFreq; count: string; days: string[] } {
  if (!rule) return { freq: 'none', count: '', days: [] };
  const freqMatch = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  const countMatch = rule.match(/COUNT=(\d+)/);
  const bydayMatch = rule.match(/BYDAY=([A-Z,]+)/);
  return {
    freq: (freqMatch?.[1] as RecurrenceFreq | undefined) ?? 'none',
    count: countMatch?.[1] ?? '',
    days: bydayMatch ? bydayMatch[1].split(',') : [],
  };
}

export function buildRecurrenceRule(freq: RecurrenceFreq, count: string, days: string[] = []): string | undefined {
  if (freq === 'none') return undefined;
  const countNum = Number(count);
  const countPart = Number.isFinite(countNum) && countNum > 0 ? `;COUNT=${countNum}` : '';
  const daysPart = freq === 'WEEKLY' && days.length > 0 ? `;BYDAY=${days.join(',')}` : '';
  return `FREQ=${freq}${countPart}${daysPart}`;
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
 * For recurring tasks, keep only the earliest future occurrence per parent entry.
 * Events are returned unchanged — all occurrences belong on the calendar.
 * Non-recurring tasks (no colon in ID) are always kept.
 *
 * Recurring occurrence IDs use the format "parentUUID:ISOTimestamp".
 * The part before the first colon is the parent entry's UUID.
 */
export function deduplicateRecurringTasks<T extends { type: string; startTime: string; id: string }>(
  entries: T[],
): T[] {
  // Find the earliest occurrence ID for each recurring-task parent
  const earliestIdByParent = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type !== 'task') continue;
    const colonIdx = entry.id.indexOf(':');
    if (colonIdx < 0) continue; // non-recurring task, always keep

    const parentKey = entry.id.slice(0, colonIdx);
    const existing = earliestIdByParent.get(parentKey);
    if (!existing) {
      earliestIdByParent.set(parentKey, entry.id);
    } else {
      // Keep whichever has the earlier startTime
      const existingEntry = entries.find(e => e.id === existing);
      if (existingEntry && entry.startTime < existingEntry.startTime) {
        earliestIdByParent.set(parentKey, entry.id);
      }
    }
  }

  const keepIds = new Set(earliestIdByParent.values());

  return entries.filter(entry => {
    if (entry.type !== 'task') return true;
    const colonIdx = entry.id.indexOf(':');
    if (colonIdx < 0) return true; // non-recurring task, always keep
    return keepIds.has(entry.id);
  });
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
