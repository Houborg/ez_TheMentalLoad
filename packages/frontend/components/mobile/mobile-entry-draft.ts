import type { Entry, Member, CreateEntryRequest } from '@mental-load/contracts';
import {
  parseRecurrenceRule,
  buildRecurrenceRule,
  toReminderDraft,
  buildRemindersPayload,
} from '@/lib/entry-utils';
import type { RecurrenceFreq, ReminderDraftMode } from '@/lib/entry-utils';

export type { RecurrenceFreq, ReminderDraftMode };

export type MobileChecklistItem = {
  text: string;
  isCompleted: boolean;
  assignedToMemberId?: string;
};

export type MobileInvitee = {
  type: 'member' | 'email';
  id?: string;
  email: string;
};

export type MobileEntryDraft = {
  title: string;
  type: 'event' | 'task';
  ownerMemberId: string;
  calendarId: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  recurrenceFreq: RecurrenceFreq;
  recurrenceCount: string;
  recurrenceDays: string[];
  checklist: MobileChecklistItem[];
  invitees: MobileInvitee[];
  reminder1Mode: ReminderDraftMode;
  reminder1CustomHours: string;
  reminder2Mode: ReminderDraftMode;
  reminder2CustomHours: string;
};

export function entryToDraft(entry: Entry, members: Member[]): MobileEntryDraft {
  const { freq, count, days } = parseRecurrenceRule(entry.recurrenceRule);
  const [r1, r2] = entry.reminders;
  const rem1 = toReminderDraft(r1?.minutesBefore);
  const rem2 = toReminderDraft(r2?.minutesBefore);

  return {
    title: entry.title,
    type: entry.type,
    ownerMemberId: entry.ownerMemberId,
    calendarId: entry.calendarId,
    startTime: entry.startTime,
    endTime: entry.endTime,
    allDay: entry.allDay,
    location: entry.location ?? '',
    recurrenceFreq: freq,
    recurrenceCount: count,
    recurrenceDays: days,
    checklist: entry.checklist.map(item => ({
      text: item.text,
      isCompleted: item.isCompleted,
      assignedToMemberId: item.assignedToMemberId,
    })),
    invitees: entry.invitees.map(inv => {
      const knownMember = members.find(m => m.email?.toLowerCase() === inv.email.toLowerCase());
      return {
        type: (knownMember ? 'member' : 'email') as 'member' | 'email',
        id: knownMember?.id,
        email: inv.email,
      };
    }),
    reminder1Mode: rem1.mode,
    reminder1CustomHours: rem1.customHours,
    reminder2Mode: rem2.mode,
    reminder2CustomHours: rem2.customHours,
  };
}

export function emptyDraft(ownerMemberId: string, calendarId: string, date = new Date()): MobileEntryDraft {
  const start = new Date(date);
  // Round up to the nearest full hour
  if (start.getMinutes() > 0 || start.getSeconds() > 0) {
    start.setHours(start.getHours() + 1);
  }
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    title: '',
    type: 'event',
    ownerMemberId,
    calendarId,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    allDay: false,
    location: '',
    recurrenceFreq: 'none',
    recurrenceCount: '',
    recurrenceDays: [],
    checklist: [],
    invitees: [],
    reminder1Mode: 'none',
    reminder1CustomHours: '',
    reminder2Mode: 'none',
    reminder2CustomHours: '',
  };
}

export function draftToPayload(draft: MobileEntryDraft): CreateEntryRequest {
  return {
    title: draft.title.trim(),
    type: draft.type,
    ownerMemberId: draft.ownerMemberId,
    calendarId: draft.calendarId,
    startTime: draft.startTime,
    endTime: draft.endTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    allDay: draft.allDay,
    location: draft.location.trim() || undefined,
    recurrenceRule: buildRecurrenceRule(draft.recurrenceFreq, draft.recurrenceCount, draft.recurrenceDays),
    checklist: draft.checklist
      .filter(item => item.text.trim())
      .map(item => ({
        text: item.text,
        isCompleted: item.isCompleted,
        assignedToMemberId: item.assignedToMemberId,
      })),
    invitees: draft.invitees.map(inv => ({ email: inv.email })),
    reminders: buildRemindersPayload(
      draft.reminder1Mode,
      draft.reminder1CustomHours,
      draft.reminder2Mode,
      draft.reminder2CustomHours,
    ),
  };
}
