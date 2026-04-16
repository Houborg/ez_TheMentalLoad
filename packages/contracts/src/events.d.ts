import type { Entry } from './domain';
export type DomainEventName = 'entry.created' | 'entry.updated' | 'entry.deleted' | 'reminder.scheduled' | 'reminder.triggered';
export interface DomainEvent<TPayload> {
    name: DomainEventName;
    payload: TPayload;
    occurredAt: string;
}
export type EntryEvent = DomainEvent<{
    entry: Entry;
}>;
