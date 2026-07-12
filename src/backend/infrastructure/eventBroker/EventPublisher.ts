// Concrete implementation of the domain IEventPublisher port. Publishes domain
// events to an EventBroker (Redis Streams by default). The domain only knows the
// IEventPublisher interface; this infrastructure class bridges to the broker.

import type { DomainEvent, IEventPublisher } from '../../domain/ports/IEventPublisher';
import type { EventBroker } from './RedisEventBroker';

export class EventPublisher implements IEventPublisher {
  constructor(private readonly broker: EventBroker) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.broker.publish(event);
  }
}

// NOTE: the default wiring (createEventPublisher backed by Redis Streams) lives
// in ./RedisWiring.ts to keep this module free of connection/config imports.
