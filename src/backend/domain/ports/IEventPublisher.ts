// Domain port for publishing domain events. The concrete broker (Redis Streams,
// etc.) lives in infrastructure; the domain only knows this interface.

export interface DomainEvent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface IEventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
