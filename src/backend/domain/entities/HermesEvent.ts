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
import { HERMES_EVENT_STATUSES } from '../../../shared/types';
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

    const status = props.status ?? 'pending_review';
    if (!HERMES_EVENT_STATUSES.includes(status)) {
      return Err(new ValidationError(`Unknown HermesEvent status: ${status}`));
    }
    const terminal = ['applied', 'dismissed', 'failed', 'reverted'].includes(status);
    const resolvedAt = props.resolvedAt ?? null;
    if (terminal !== (resolvedAt !== null)) {
      return Err(
        new ValidationError(
          terminal
            ? `HermesEvent status ${status} requires resolvedAt`
            : `HermesEvent status ${status} must not have resolvedAt`,
        ),
      );
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
        status,
        props.title.trim(),
        props.detail ?? null,
        props.proposedChange,
        props.autonomyDecision ?? null,
        props.createdAt ?? new Date(),
        resolvedAt,
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
    if (type === 'olx_category_mismatch' && change.kind !== 'category_recreation') {
      return Err(new ValidationError('olx_category_mismatch requires a category_recreation change'));
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

  // Human approval starts execution; it does not claim the side effect succeeded.
  approve(): Result<void> {
    if (this._status !== 'pending_review') {
      return Err(
        new InvalidStateError(`Cannot approve event in ${this._status} state`),
      );
    }
    this._status = 'applying';
    this._resolvedAt = null;
    return Ok(undefined);
  }

  beginAutoApply(): Result<void> {
    if (this._status !== 'pending_decision') {
      return Err(
        new InvalidStateError(`Cannot auto-apply event in ${this._status} state`),
      );
    }
    this._status = 'applying';
    this._resolvedAt = null;
    return Ok(undefined);
  }

  requestReview(): Result<void> {
    if (this._status !== 'pending_decision') {
      return Err(
        new InvalidStateError(`Cannot request review from ${this._status} state`),
      );
    }
    this._status = 'pending_review';
    this._resolvedAt = null;
    return Ok(undefined);
  }

  dismiss(at: Date = new Date()): Result<void> {
    if (this._status !== 'pending_review' && this._status !== 'pending_decision') {
      return Err(
        new InvalidStateError(`Cannot dismiss event in ${this._status} state`),
      );
    }
    this._status = 'dismissed';
    this._resolvedAt = at;
    return Ok(undefined);
  }

  markApplied(at: Date = new Date()): Result<void> {
    if (this._status !== 'applying') {
      return Err(
        new InvalidStateError(`Cannot mark event applied from ${this._status}`),
      );
    }
    this._status = 'applied';
    this._resolvedAt = at;
    return Ok(undefined);
  }

  markFailed(at: Date = new Date()): Result<void> {
    if (this._status !== 'applying') {
      return Err(
        new InvalidStateError(`Cannot mark event failed from ${this._status}`),
      );
    }
    this._status = 'failed';
    this._resolvedAt = at;
    return Ok(undefined);
  }

  beginRevert(): Result<void> {
    if (this._status !== 'applied') {
      return Err(
        new InvalidStateError(`Cannot revert event in ${this._status} state`),
      );
    }
    this._status = 'reverting';
    this._resolvedAt = null;
    return Ok(undefined);
  }

  markReverted(at: Date = new Date()): Result<void> {
    if (this._status !== 'reverting') {
      return Err(
        new InvalidStateError(`Cannot mark event reverted from ${this._status}`),
      );
    }
    this._status = 'reverted';
    this._resolvedAt = at;
    return Ok(undefined);
  }
}
