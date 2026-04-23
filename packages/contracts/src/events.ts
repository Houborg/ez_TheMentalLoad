import type { Entry, TimelineTaskInstance } from './domain';

export type DomainEventName =
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'reminder.scheduled'
  | 'reminder.triggered'
  | 'timeline.step.reached'
  | 'timeline.step.completed';

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
