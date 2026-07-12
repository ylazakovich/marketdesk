// HermesEvent entity (AI event log entry). Invariants per ARCHITECTURE.md §3:
//   - proposedChange must be fully typed and consistent with the event type
//   - can only approve while status = pending_review
//   - critical price drops (> 20%) must await human review (never auto-apply)

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError, InvalidStateError } from '../shared/DomainError';
import type {
  HermesEventType,
  HermesSeverity,
  HermesEventStatus,
  AutonomyDecision,
  ProposedChange,
} from '../../../shared/types';
import { CRITICAL_PRICE_DROP_THRESHOLD } from '../../../shared/constants';

export interface CreateHermesEventProps {
  id: string;
  workspaceId: string;
  productId?: string | null;
  type: HermesEventType;
  severity: HermesSeverity;
  title: string;
  detail?: string | null;
  proposedChange: ProposedChange;
  status?: HermesEventStatus;
  autonomyDecision?: AutonomyDecision | null;
  createdAt?: Date;
  resolvedAt?: Date | null;
}

const PRICE_EVENT_TYPES: HermesEventType[] = [
  'suggested_lower_price',
  'suggested_higher_price',
  'competitor_price_detected',
];

export class HermesEvent {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly productId: string | null,
    public readonly type: HermesEventType,
    public readonly severity: HermesSeverity,
    private _status: HermesEventStatus,
    public readonly title: string,
    public readonly detail: string | null,
    public readonly proposedChange: ProposedChange,
    private _autonomyDecision: AutonomyDecision | null,
    public readonly createdAt: Date,
    private _resolvedAt: Date | null,
  ) {}

  static create(props: CreateHermesEventProps): Result<HermesEvent> {
    if (!props.id?.trim()) {
      return Err(new ValidationError('HermesEvent id is required'));
    }
    if (!props.workspaceId?.trim()) {
      return Err(new ValidationError('HermesEvent workspaceId is required'));
    }
    if (!props.title?.trim()) {
      return Err(new ValidationError('HermesEvent title is required'));
    }

    const changeCheck = HermesEvent.validateProposedChange(
      props.type,
      props.proposedChange,
    );
    if (changeCheck.isErr()) return changeCheck;

    return Ok(
      new HermesEvent(
        props.id,
        props.workspaceId,
        props.productId ?? null,
        props.type,
        props.severity,
        props.status ?? 'pending_review',
        props.title.trim(),
        props.detail ?? null,
        props.proposedChange,
        props.autonomyDecision ?? null,
        props.createdAt ?? new Date(),
        props.resolvedAt ?? null,
      ),
    );
  }

  // Enforce "proposedChange must be fully typed" — the payload shape must match
  // the event type. `null` is permitted for informational-only events.
  private static validateProposedChange(
    type: HermesEventType,
    change: ProposedChange,
  ): Result<true> {
    if (change === null) {
      // Only non-actionable/informational events may omit a proposed change.
      const requiresChange =
        PRICE_EVENT_TYPES.includes(type) ||
        type === 'suggested_better_title' ||
        type === 'update_description' ||
        type === 'relist' ||
        type === 'needs_relisting' ||
        type === 'create_listing';
      if (requiresChange) {
        return Err(
          new ValidationError(`Event type ${type} requires a proposed change`),
        );
      }
      return Ok(true);
    }

    if (PRICE_EVENT_TYPES.includes(type)) {
      if (
        change.kind !== 'price' ||
        typeof change.from !== 'number' ||
        typeof change.to !== 'number'
      ) {
        return Err(
          new ValidationError(`Event type ${type} requires a typed price change`),
        );
      }
      return Ok(true);
    }

    if (type === 'suggested_better_title' && change.kind !== 'title') {
      return Err(new ValidationError('suggested_better_title requires a title change'));
    }
    if (type === 'update_description' && change.kind !== 'description') {
      return Err(
        new ValidationError('update_description requires a description change'),
      );
    }
    if ((type === 'relist' || type === 'needs_relisting') && change.kind !== 'relist') {
      return Err(new ValidationError(`${type} requires a relist change`));
    }
    if (type === 'create_listing' && change.kind !== 'create_listing') {
      return Err(new ValidationError('create_listing requires a create_listing change'));
    }

    return Ok(true);
  }

  // --- Getters ---
  get status(): HermesEventStatus {
    return this._status;
  }
  get autonomyDecision(): AutonomyDecision | null {
    return this._autonomyDecision;
  }
  get resolvedAt(): Date | null {
    return this._resolvedAt;
  }

  // --- Behavior ---

  // True when this event must not be auto-applied and requires a human.
  requiresHumanReview(): boolean {
    if (this.severity === 'critical' && this.type === 'competitor_price_detected') {
      return true;
    }
    if (this.proposedChange && this.proposedChange.kind === 'price') {
      const { from, to } = this.proposedChange;
      if (from > 0 && to < from) {
        const dropFraction = (from - to) / from;
        if (dropFraction > CRITICAL_PRICE_DROP_THRESHOLD) {
          return true;
        }
      }
    }
    return false;
  }

  setAutonomyDecision(decision: AutonomyDecision): void {
    this._autonomyDecision = decision;
  }

  // Approve a pending suggestion; the executor then applies the change.
  approve(at: Date = new Date()): Result<void> {
    if (this._status !== 'pending_review') {
      return Err(
        new InvalidStateError(`Cannot approve event in ${this._status} state`),
      );
    }
    this._status = 'applied';
    this._resolvedAt = at;
    return Ok(undefined);
  }

  dismiss(at: Date = new Date()): Result<void> {
    if (this._status !== 'pending_review') {
      return Err(
        new InvalidStateError(`Cannot dismiss event in ${this._status} state`),
      );
    }
    this._status = 'dismissed';
    this._resolvedAt = at;
    return Ok(undefined);
  }

  // Mark an auto-applied event as resolved (used by the decision engine).
  markApplied(at: Date = new Date()): void {
    if (this._status !== 'pending_review') {
      return;
    }
    this._status = 'applied';
    this._resolvedAt = at;
  }
}
