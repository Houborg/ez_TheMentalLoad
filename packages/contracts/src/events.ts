import type { Entry, TimelineTaskInstance, AulaPresence } from './domain';

export type DomainEventName =
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'reminder.scheduled'
  | 'reminder.triggered'
  | 'timeline.step.reached'
  | 'timeline.step.completed'
  | 'aula.presence.updated';

export interface DomainEvent<TPayload> {
  name: DomainEventName;
  payload: TPayload;
  occurredAt: string;
}

export type EntryEvent = DomainEvent<{ entry: Entry }>;

export type TimelineStepReachedEvent = DomainEvent<{
  memberId: string;
  date: string;
  task: TimelineTaskInstance;
}>;

export type TimelineStepCompletedEvent = DomainEvent<{
  memberId: string;
  date: string;
  task: TimelineTaskInstance;
  completedByMemberId?: string;
}>;

export type AulaPresenceUpdatedEvent = DomainEvent<{
  memberId: string;
  presence: AulaPresence;
}>;
