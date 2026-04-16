import type { Calendar, Entry, Member } from './domain';
export interface ApiHealth {
    status: 'ok';
    service: string;
    now: string;
}
export interface DashboardSnapshot {
    members: Member[];
    calendars: Calendar[];
    entries: Entry[];
}
export type CreateEntryRequest = Pick<Entry, 'title' | 'type' | 'ownerMemberId' | 'calendarId' | 'startTime' | 'endTime' | 'timezone' | 'allDay' | 'location' | 'recurrenceRule'> & {
    reminders?: Array<{
        minutesBefore: number;
    }>;
};
export type UpdateEntryRequest = Partial<CreateEntryRequest> & {
    status?: Entry['status'];
};
