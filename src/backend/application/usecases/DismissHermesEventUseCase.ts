// Use case: dismiss a pending Hermes event. No change is applied; the event is
// marked dismissed and the action is recorded in the activity log.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError, InvalidStateError } from '../../domain/shared/DomainError';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { IdGenerator } from '../ports/IdGenerator';
import type { DismissEventDTO } from '../dto/ApproveEventDTO';

export class DismissHermesEventUseCase {
  constructor(
    private readonly eventRepo: IEventRepository,
    private readonly activityLog: IActivityLogRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(input: DismissEventDTO): Promise<Result<HermesEvent>> {
    // Tenant-scoped load: reject events belonging to another workspace (S2).
    const event = await this.eventRepo.findByIdForWorkspace(
      input.eventId,
      input.workspaceId,
    );
    if (!event) {
      return Err(new NotFoundError(`Hermes event not found: ${input.eventId}`));
    }

    if (event.status !== 'pending_review') {
      return Err(
        new InvalidStateError(
          `Cannot dismiss event in ${event.status} state (must be pending_review)`,
        ),
      );
    }

    const dismissed = event.dismiss();
    if (dismissed.isErr()) return dismissed;

    await this.eventRepo.save(event);

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: event.workspaceId,
      entityType: 'hermes_event',
      entityId: event.id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'hermes_event.dismissed',
      metadata: { eventType: event.type, reason: input.reason },
      createdAt: event.resolvedAt ?? new Date(),
    });

    try {
      await this.eventPublisher.publish(this.dismissedEvent(event));
    } catch {
      // Dismissal already persisted; don't fail the request over a
      // best-effort notification failure. Consider logging/metrics here.
    }

    return Ok(event);
  }

  private dismissedEvent(event: HermesEvent): DomainEvent {
    return {
      type: 'hermes.event.dismissed',
      aggregateType: 'HermesEvent',
      aggregateId: event.id,
      payload: { eventId: event.id, workspaceId: event.workspaceId },
      occurredAt: new Date(),
    };
  }
}
