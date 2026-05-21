import type { Entry } from '@mental-load/contracts';

export interface ConnectionConfig {
  provider: 'apple' | 'google';
  caldavUrl: string;
  username: string;
  password: string;
  calendarPath: string;
}

export interface RemoteEvent {
  uid: string;
  url: string;
  etag: string;
  icalData: string;
  updatedAt?: string;
}

export interface CalendarAdapter {
  /** Attempt to authenticate. Returns true if credentials are valid. */
  verify(config: ConnectionConfig): Promise<boolean>;

  /** List available calendars on the remote account. */
  listCalendars(config: Pick<ConnectionConfig, 'caldavUrl' | 'username' | 'password'>): Promise<Array<{ url: string; displayName: string; eventCount?: number }>>;

  /** Fetch all events from the remote calendar since a given date. */
  importEvents(config: ConnectionConfig, since?: Date): Promise<RemoteEvent[]>;

  /** Push a MentalLoad entry to the remote calendar. Returns the remote URL. */
  exportEntry(config: ConnectionConfig, entry: Entry): Promise<string>;

  /** Delete a remote event by URL. */
  deleteRemoteEvent(config: ConnectionConfig, eventUrl: string): Promise<void>;
}
