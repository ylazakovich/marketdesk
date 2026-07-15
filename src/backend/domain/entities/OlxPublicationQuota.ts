import { Err, Ok, type Result } from '../shared/Result';
import { ValidationError } from '../shared/DomainError';

export type OlxQuotaSource = 'operator' | 'provider' | 'reconciled';
export type OlxQuotaConfidence = 'verified' | 'estimated';
export type OlxQuotaStatus =
  | 'available'
  | 'exhausted'
  | 'stale'
  | 'unverified'
  | 'unknown'
  | 'not_applicable';
export type OlxQuotaDecisionKind = 'allow' | 'block' | 'override' | 'not_applicable';

export interface CreateOlxPublicationQuotaProps {
  id: string;
  workspaceId: string;
  marketplaceId: string;
  marketplaceAccountId: string;
  subcategoryId: string;
  cycleStartedAt: Date;
  cycleEndsAt: Date;
  publicationLimit: number;
  consumed: number;
  source: OlxQuotaSource;
  confidence: OlxQuotaConfidence;
  verifiedAt: Date;
  staleAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OlxQuotaEvaluation {
  status: Exclude<OlxQuotaStatus, 'unknown' | 'not_applicable'>;
  canPublishForFree: boolean;
  reason:
    | 'free_unit_available'
    | 'quota_exhausted'
    | 'quota_stale'
    | 'quota_unverified'
    | 'outside_cycle';
}

export function decideOlxPublication(
  evaluation: OlxQuotaEvaluation | undefined,
  overrideConfirmed: boolean,
  hasQuota: boolean,
): { decision: Exclude<OlxQuotaDecisionKind, 'not_applicable'>; consumedUnit: boolean } {
  const decision = evaluation?.canPublishForFree
    ? 'allow'
    : overrideConfirmed
      ? 'override'
      : 'block';
  return { decision, consumedUnit: decision !== 'block' && hasQuota };
}

export class OlxPublicationQuota {
  private constructor(private readonly props: CreateOlxPublicationQuotaProps) {}

  static create(props: CreateOlxPublicationQuotaProps): Result<OlxPublicationQuota> {
    for (const [name, value] of [
      ['id', props.id],
      ['workspaceId', props.workspaceId],
      ['marketplaceId', props.marketplaceId],
      ['marketplaceAccountId', props.marketplaceAccountId],
      ['subcategoryId', props.subcategoryId],
    ] as const) {
      if (!value?.trim()) return Err(new ValidationError(`${name} is required`));
    }
    if (!Number.isInteger(props.publicationLimit) || props.publicationLimit < 0) {
      return Err(new ValidationError('publicationLimit must be a non-negative integer'));
    }
    if (!Number.isInteger(props.consumed) || props.consumed < 0) {
      return Err(new ValidationError('consumed must be a non-negative integer'));
    }
    for (const [name, date] of [
      ['cycleStartedAt', props.cycleStartedAt],
      ['cycleEndsAt', props.cycleEndsAt],
      ['verifiedAt', props.verifiedAt],
      ['staleAt', props.staleAt],
    ] as const) {
      if (!Number.isFinite(date.getTime())) {
        return Err(new ValidationError(`${name} must be a valid date`));
      }
    }
    if (props.cycleStartedAt.getTime() >= props.cycleEndsAt.getTime()) {
      return Err(new ValidationError('cycleStartedAt must be before cycleEndsAt'));
    }
    if (props.verifiedAt.getTime() >= props.staleAt.getTime()) {
      return Err(new ValidationError('verifiedAt must be before staleAt'));
    }
    return Ok(new OlxPublicationQuota({
      ...props,
      subcategoryId: props.subcategoryId.trim(),
      createdAt: props.createdAt ?? new Date(),
      updatedAt: props.updatedAt ?? new Date(),
    }));
  }

  get id(): string { return this.props.id; }
  get workspaceId(): string { return this.props.workspaceId; }
  get marketplaceId(): string { return this.props.marketplaceId; }
  get marketplaceAccountId(): string { return this.props.marketplaceAccountId; }
  get subcategoryId(): string { return this.props.subcategoryId; }
  get cycleStartedAt(): Date { return this.props.cycleStartedAt; }
  get cycleEndsAt(): Date { return this.props.cycleEndsAt; }
  get publicationLimit(): number { return this.props.publicationLimit; }
  get consumed(): number { return this.props.consumed; }
  get source(): OlxQuotaSource { return this.props.source; }
  get confidence(): OlxQuotaConfidence { return this.props.confidence; }
  get verifiedAt(): Date { return this.props.verifiedAt; }
  get staleAt(): Date { return this.props.staleAt; }
  get createdAt(): Date { return this.props.createdAt!; }
  get updatedAt(): Date { return this.props.updatedAt!; }
  get remaining(): number { return Math.max(0, this.publicationLimit - this.consumed); }

  evaluate(now: Date): OlxQuotaEvaluation {
    if (![now, this.cycleStartedAt, this.cycleEndsAt, this.verifiedAt, this.staleAt]
      .every((date) => Number.isFinite(date.getTime()))) {
      return { status: 'stale', canPublishForFree: false, reason: 'outside_cycle' };
    }
    if (now.getTime() < this.cycleStartedAt.getTime() || now.getTime() >= this.cycleEndsAt.getTime()) {
      return { status: 'stale', canPublishForFree: false, reason: 'outside_cycle' };
    }
    if (now.getTime() >= this.staleAt.getTime()) {
      return { status: 'stale', canPublishForFree: false, reason: 'quota_stale' };
    }
    if (this.confidence !== 'verified') {
      return { status: 'unverified', canPublishForFree: false, reason: 'quota_unverified' };
    }
    if (this.remaining <= 0) {
      return { status: 'exhausted', canPublishForFree: false, reason: 'quota_exhausted' };
    }
    return { status: 'available', canPublishForFree: true, reason: 'free_unit_available' };
  }
}
