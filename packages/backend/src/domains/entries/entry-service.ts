import { v4 as uuid } from 'uuid';
import * as ical from 'node-ical';
import { rrulestr } from 'rrule';
import type { ChecklistItem, CreateEntryRequest, Entry, Invitee, ReminderConfig, UpdateEntryRequest } from '@mental-load/contracts';
import { DomainEventBus } from '../../events/domain-event-bus';
import type { ReminderJobRecord, ReminderScheduler } from '../../reminders/reminder-scheduler';
import type { EntryRepository } from '../../repositories/entry-repository';

export class EntryService {
  constructor(
    private readonly entryRepository: EntryRepository,
    private readonly eventBus: DomainEventBus,
    private readonly reminderScheduler: ReminderScheduler,
  ) {}

  async listEntries(): Promise<Entry[]> {
    return this.entryRepository.list();
  }

  async listOccurrences(from: string, to: string): Promise<Entry[]> {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const entries = await this.entryRepository.list();
    const occurrences: Entry[] = [];

    for (const entry of entries) {
      const baseStart = new Date(entry.startTime);
      const baseEnd = new Date(entry.endTime);
      const duration = baseEnd.getTime() - baseStart.getTime();

      if (entry.recurrenceRule) {
        const rule = rrulestr(entry.recurrenceRule, { dtstart: baseStart });
        const dates = rule.between(rangeStart, rangeEnd, true);

        for (const occurrenceStart of dates) {
          const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
          occurrences.push({
            ...entry,
            id: `${entry.id}:${occurrenceStart.toISOString()}`,
            startTime: occurrenceStart.toISOString(),
            endTime: occurrenceEnd.toISOString(),
          });
        }
      } else if (baseStart <= rangeEnd && baseEnd >= rangeStart) {
        occurrences.push(entry);
      }
    }

    return occurrences.sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  async createEntry(input: CreateEntryRequest): Promise<Entry> {
    validateRecurrence(input.recurrenceRule);

    const now = new Date().toISOString();
    const entry: Entry = {
      id: uuid(),
      title: input.title,
      type: input.type,
      ownerMemberId: input.ownerMemberId,
      calendarId: input.calendarId,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      allDay: input.allDay,
      reminders: normalizeReminderConfigs(input.reminders),
      checklist: normalizeChecklistItems(input.checklist),
      status: 'active',
      location: input.location,
      recurrenceRule: input.recurrenceRule,
      parentEntryId: input.parentEntryId,
      invitees: normalizeInvitees(input.invitees),
      linkedEntryIds: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.entryRepository.create(entry);
    await this.applyBirthdayRule(entry);
    await this.scheduleReminders(entry);
    this.publish('entry.created', { entry });
    return entry;
  }

  async updateEntry(id: string, patch: UpdateEntryRequest): Promise<Entry | undefined> {
    validateRecurrence(patch.recurrenceRule);

    const { reminders, checklist, invitees, ...rest } = patch;
    const normalizedPatch: Partial<Entry> = {
      ...rest,
    };

    if (reminders !== undefined) {
      normalizedPatch.reminders = normalizeReminderConfigs(reminders);
    }

    if (checklist !== undefined) {
      normalizedPatch.checklist = normalizeChecklistItems(checklist);
    }

    if (invitees !== undefined) {
      normalizedPatch.invitees = normalizeInvitees(invitees);
    }

    const updated = await this.entryRepository.update(id, normalizedPatch);
    if (updated) {
      await this.scheduleReminders(updated);
      this.publish('entry.updated', { entry: updated });
    }
    return updated;
  }

  async deleteEntry(id: string): Promise<boolean> {
    const existing = await this.entryRepository.findById(id);
    const deleted = await this.entryRepository.delete(id);

    if (deleted && existing) {
      this.publish('entry.deleted', { entry: existing });
    }

    return deleted;
  }

  async exportCalendarIcs(calendarId: string): Promise<string> {
    const entries = (await this.entryRepository.list()).filter((entry) => entry.calendarId === calendarId);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MentalLoad//Planner//EN', 'CALSCALE:GREGORIAN'];

    for (const entry of entries) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${entry.id}`);
      lines.push(`DTSTAMP:${toIcsTimestamp(entry.updatedAt)}`);
      lines.push(`DTSTART:${toIcsTimestamp(entry.startTime, entry.allDay)}`);
      lines.push(`DTEND:${toIcsTimestamp(entry.endTime, entry.allDay)}`);
      lines.push(`SUMMARY:${escapeIcsText(entry.title)}`);
      lines.push(`STATUS:${entry.status.toUpperCase()}`);
      lines.push(`CATEGORIES:${entry.type.toUpperCase()}`);
      if (entry.location) {
        lines.push(`LOCATION:${escapeIcsText(entry.location)}`);
      }
      if (entry.recurrenceRule) {
        lines.push(`RRULE:${entry.recurrenceRule}`);
      }
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
  }

  async importFromIcs(input: { calendarId: string; ownerMemberId: string; ics: string }): Promise<{ importedCount: number }> {
    const parsed = ical.sync.parseICS(input.ics) as Record<string, NodeIcsEvent>;
    let importedCount = 0;

    for (const event of Object.values(parsed)) {
      if (event.type !== 'VEVENT' || !(event.start instanceof Date)) {
        continue;
      }

      await this.createEntry({
        title: event.summary ?? 'Imported event',
        type: 'event',
        ownerMemberId: input.ownerMemberId,
        calendarId: input.calendarId,
        startTime: event.start.toISOString(),
        endTime: event.end instanceof Date ? event.end.toISOString() : event.start.toISOString(),
        timezone: event.start.tz ?? 'UTC',
        allDay: event.datetype === 'date',
        location: event.location,
        recurrenceRule: event.rrule?.toString().replace(/^RRULE:/, ''),
        reminders: [],
      });
      importedCount += 1;
    }

    return { importedCount };
  }

  async listReminderJobs(): Promise<ReminderJobRecord[]> {
    return this.reminderScheduler.listJobs();
  }

  private async applyBirthdayRule(entry: Entry): Promise<void> {
    const normalized = entry.title.toLowerCase();
    const isBirthday = normalized.includes('birthday') || normalized.includes('fødselsdag');

    if (!isBirthday) {
      return;
    }

    const existingEntries = await this.entryRepository.list();
    const duplicateGiftTask = existingEntries.find(
      (candidate) => candidate.parentEntryId === entry.id && candidate.title === 'Buy a gift',
    );

    if (duplicateGiftTask) {
      return;
    }

    const reminderExists = entry.reminders.some((reminder) => reminder.minutesBefore === 1440);
    if (!reminderExists) {
      entry.reminders.push({ id: uuid(), minutesBefore: 1440 });
      await this.entryRepository.update(entry.id, { reminders: entry.reminders });
    }

    const task: Entry = {
      ...entry,
      id: uuid(),
      type: 'task',
      title: 'Buy a gift',
      allDay: true,
      reminders: [{ id: uuid(), minutesBefore: 1440 }],
      checklist: [
        { id: uuid(), text: 'Choose a gift', isCompleted: false },
        { id: uuid(), text: 'Wrap the gift', isCompleted: false },
      ],
      linkedEntryIds: [],
      parentEntryId: entry.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.entryRepository.create(task);
    await this.entryRepository.update(entry.id, { linkedEntryIds: [...entry.linkedEntryIds, task.id] });
    await this.scheduleReminders(task);
    this.publish('entry.created', { entry: task });
  }

  private async scheduleReminders(entry: Entry): Promise<void> {
    const jobs = await this.reminderScheduler.scheduleForEntry(entry);

    for (const job of jobs) {
      this.eventBus.emit({
        name: 'reminder.scheduled',
        payload: { entryId: entry.id, reminderId: job.reminderId, runAt: job.runAt },
        occurredAt: new Date().toISOString(),
      });
    }
  }

  private publish(name: 'entry.created' | 'entry.updated' | 'entry.deleted', payload: EntryEventPayload): void {
    this.eventBus.emit({
      name,
      payload,
      occurredAt: new Date().toISOString(),
    });
  }
}

type EntryEventPayload = { entry: Entry };

type NodeIcsEvent = {
  type?: string;
  summary?: string;
  start?: Date & { tz?: string };
  end?: Date;
  location?: string;
  datetype?: string;
  rrule?: { toString(): string };
};

function validateRecurrence(recurrenceRule?: string): void {
  if (!recurrenceRule) {
    return;
  }

  rrulestr(recurrenceRule);
}

function normalizeReminderConfigs(reminders?: Array<{ minutesBefore: number }>): ReminderConfig[] {
  return (reminders ?? [])
    .filter((reminder) => Number.isFinite(reminder.minutesBefore) && reminder.minutesBefore > 0)
    .map((reminder) => ({
      id: uuid(),
      minutesBefore: Math.round(reminder.minutesBefore),
    }));
}

function normalizeChecklistItems(items?: Array<{ text: string; isCompleted?: boolean }>): ChecklistItem[] {
  return (items ?? [])
    .filter((item) => item.text.trim())
    .map((item) => ({
      id: uuid(),
      text: item.text.trim(),
      isCompleted: item.isCompleted ?? false,
    }));
}

function normalizeInvitees(invitees?: Array<{ email: string }>): Invitee[] {
  return (invitees ?? []).map((invitee) => ({
    id: uuid(),
    email: invitee.email,
    status: 'pending',
  }));
}

function toIcsTimestamp(value: string, allDay = false): string {
  const date = new Date(value);
  if (allDay) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}
