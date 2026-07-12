// Redis Streams-based event broker. Appends domain events to per-aggregate
// streams via XADD. The Redis dependency is behind a minimal injectable
// interface so the broker is unit-testable without a live Redis; a default
// factory wires the real client from config/redis.

import type { DomainEvent } from '../../domain/ports/IEventPublisher';

// Only the slice of the Redis client the broker needs.
export interface RedisStreamClient {
  xadd(key: string, id: string, ...args: string[]): Promise<string | null>;
}

// Generic broker abstraction the EventPublisher depends on. Keeps the publisher
// decoupled from the transport (Redis Streams here, but swappable).
export interface EventBroker {
  publish(event: DomainEvent): Promise<string>;
}

// In-process fan-out port. The WebSocket layer (HermesLiveUpdates) needs to
// observe every published domain event to push it to subscribed clients. Redis
// Streams durably records events (publish/XADD), but the live push is served by
// this lightweight in-process subscription so a single node fans events out to
// its own WS clients without an extra consumer-group round-trip.
export interface EventSubscriber {
  subscribe(handler: (event: DomainEvent) => void): () => void;
}

export interface RedisEventBrokerOptions {
  streamPrefix?: string;
}

export class RedisEventBroker implements EventBroker, EventSubscriber {
  private readonly streamPrefix: string;
  private readonly subscribers = new Set<(event: DomainEvent) => void>();

  constructor(
    private readonly redis: RedisStreamClient,
    options: RedisEventBrokerOptions = {},
  ) {
    this.streamPrefix = options.streamPrefix ?? 'hermes:events:';
  }

  // Append the event to its aggregate stream. Returns the generated stream entry id.
  async publish(event: DomainEvent): Promise<string> {
    const stream = `${this.streamPrefix}${event.aggregateType}`;
    const id = await this.redis.xadd(
      stream,
      '*',
      'type',
      event.type,
      'aggregateType',
      event.aggregateType,
      'aggregateId',
      event.aggregateId,
      'payload',
      JSON.stringify(event.payload),
      'occurredAt',
      event.occurredAt.toISOString(),
    );
    this.notify(event);
    return id ?? '';
  }

  // Register an in-process handler for published events; returns an unsubscribe
  // function. Additive to the durable XADD path above — existing publishers are
  // unaffected when there are no subscribers.
  subscribe(handler: (event: DomainEvent) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  private notify(event: DomainEvent): void {
    for (const handler of this.subscribers) {
      // A misbehaving subscriber must never break the publish path.
      try {
        handler(event);
      } catch {
        // Swallow: live fan-out is best-effort.
      }
    }
  }
}

// NOTE: the default wiring that binds this broker to the real Redis client
// (config/redis) lives in ./RedisWiring.ts so this module stays free of any
// connection/config import and is trivially unit-testable.
