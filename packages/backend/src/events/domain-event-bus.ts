import { EventEmitter } from 'node:events';
import type { DomainEvent, DomainEventName } from '@mental-load/contracts';

export class DomainEventBus {
  private readonly emitter = new EventEmitter();

  emit<TPayload>(event: DomainEvent<TPayload>): void {
    this.emitter.emit(event.name, event);
  }

  on<TPayload>(name: DomainEventName, listener: (event: DomainEvent<TPayload>) => void): void {
    this.emitter.on(name, listener as (...args: unknown[]) => void);
  }
}
