import { createDAVClient } from 'tsdav';
import type { Entry } from '@mental-load/contracts';
import type { CalendarAdapter, ConnectionConfig, RemoteEvent } from './calendar-adapter';

export class AppleCalDavAdapter implements CalendarAdapter {
  private async createClient(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>) {
    return createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: { username: config.username, password: config.password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  }

  async verify(config: ConnectionConfig): Promise<boolean> {
    try {
      const client = await this.createClient(config);
      await client.fetchCalendars();
      return true;
    } catch {
      return false;
    }
  }

  async listCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>): Promise<Array<{ url: string; displayName: string; eventCount?: number }>> {
    const client = await this.createClient(config);
    const calendars = await client.fetchCalendars();
    return calendars.map((cal) => ({
      url: cal.url,
      displayName: typeof cal.displayName === 'string' ? cal.displayName : cal.url,
    }));
  }

  async importEvents(config: ConnectionConfig, since?: Date): Promise<RemoteEvent[]> {
    const client = await this.createClient(config);
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) return [];

    const timeRange = since
      ? {
          timeRange: {
            start: since.toISOString(),
            end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          },
        }
      : {};
    const objects = await client.fetchCalendarObjects({ calendar: target, ...timeRange });

    return objects
      .filter((obj) => obj.data)
      .map((obj) => ({
        uid: extractUid(obj.data as string),
        url: obj.url,
        etag: obj.etag ?? '',
        icalData: obj.data as string,
      }));
  }

  async exportEntry(config: ConnectionConfig, entry: Entry): Promise<string> {
    const client = await this.createClient(config);
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) throw new Error('Target calendar not found on remote');

    const uid = `mental-load-${entry.id}@mentalload`;
    const icalString = entryToIcal(entry, uid);
    const filename = `${uid}.ics`;

    const existing = await client.fetchCalendarObjects({ calendar: target });
    const match = existing.find((o) => typeof o.data === 'string' && o.data.includes(`UID:${uid}`));

    if (match) {
      await client.updateCalendarObject({ calendarObject: { ...match, data: icalString } });
      return match.url;
    } else {
      await client.createCalendarObject({ calendar: target, filename, iCalString: icalString });
      const base = target.url.endsWith('/') ? target.url : `${target.url}/`;
      return `${base}${filename}`;
    }
  }

  async deleteRemoteEvent(config: ConnectionConfig, eventUrl: string): Promise<void> {
    const client = await this.createClient(config);
    const calendars = await client.fetchCalendars();
    const target = calendars.find((c) => c.url === config.calendarPath) ?? calendars[0];
    if (!target) return;

    const objects = await client.fetchCalendarObjects({ calendar: target });
    const match = objects.find((o) => o.url === eventUrl);
    if (match) {
      await client.deleteCalendarObject({ calendarObject: match });
    }
  }
}

function extractUid(icalData: string): string {
  const match = icalData.match(/^UID:(.+)$/m);
  return match?.[1]?.trim() ?? '';
}

function formatIcalDate(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function entryToIcal(entry: Entry, uid: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MentalLoad//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcalDate(new Date().toISOString(), false)}`,
    `DTSTART${entry.allDay ? ';VALUE=DATE' : ''}:${formatIcalDate(entry.startTime, entry.allDay)}`,
    `DTEND${entry.allDay ? ';VALUE=DATE' : ''}:${formatIcalDate(entry.endTime, entry.allDay)}`,
    `SUMMARY:${entry.title.replace(/\n/g, '\\n')}`,
  ];
  if (entry.location) lines.push(`LOCATION:${entry.location.replace(/\n/g, '\\n')}`);
  if (entry.recurrenceRule) lines.push(`RRULE:${entry.recurrenceRule}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
