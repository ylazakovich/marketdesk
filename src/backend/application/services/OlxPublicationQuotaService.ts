import type { Listing } from '../../domain/entities/Listing';
import type { Marketplace } from '../../domain/entities/Marketplace';
import { OlxPublicationQuota } from '../../domain/entities/OlxPublicationQuota';
import type { Product } from '../../domain/entities/Product';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type {
  IOlxPublicationQuotaRepository,
  OlxPublicationAuthorization,
} from '../../domain/repositories/interfaces/IOlxPublicationQuotaRepository';
import {
  GuardrailViolationError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../../domain/shared/DomainError';
import type { IdGenerator } from '../ports/IdGenerator';
import type { MarketplaceAccountRepository, MarketplaceAccountRecord } from './MarketplaceOAuthService';
import type { OlxQuotaConfidence, OlxQuotaSource, OlxQuotaStatus } from '../../domain/entities/OlxPublicationQuota';

export interface OlxSubcategoryResolver {
  resolve(domainCategory: string): string | null;
}

export interface OlxQuotaOverride {
  confirmed: true;
  reason: string;
}

export interface OlxQuotaView {
  id: string;
  workspaceId: string;
  marketplaceId: string;
  marketplaceAccountId: string;
  subcategoryId: string;
  cycleStartedAt: string;
  cycleEndsAt: string;
  publicationLimit: number;
  consumed: number;
  remaining: number;
  source: OlxQuotaSource;
  confidence: OlxQuotaConfidence;
  verifiedAt: string;
  staleAt: string;
  isStale: boolean;
  status: Exclude<OlxQuotaStatus, 'unknown' | 'not_applicable'>;
}

export interface OlxQuotaDecisionView {
  applicable: boolean;
  marketplaceKey: 'olx' | null;
  marketplaceAccountId?: string;
  subcategoryId?: string;
  status: OlxQuotaStatus;
  decision: 'allow' | 'block' | 'override' | 'not_applicable';
  reason: string;
  requiresOverride: boolean;
  consumedUnit?: boolean;
  quota?: OlxQuotaView;
}

export interface SetOlxQuotaInput {
  marketplaceId: string;
  workspaceId: string;
  actorId?: string;
  subcategoryId: string;
  cycleStartedAt: string;
  cycleEndsAt: string;
  publicationLimit: number;
  consumed: number;
  source: OlxQuotaSource;
  confidence: OlxQuotaConfidence;
  verifiedAt: string;
  staleAt: string;
}

export class OlxPublicationQuotaService {
  private readonly now: () => Date;

  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly accountRepo: MarketplaceAccountRepository,
    private readonly quotaRepo: IOlxPublicationQuotaRepository,
    private readonly activityLog: IActivityLogRepository,
    private readonly idGenerator: IdGenerator,
    private readonly subcategories: OlxSubcategoryResolver,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date());
  }

  async list(input: { marketplaceId: string; workspaceId: string }): Promise<OlxQuotaView[]> {
    const { marketplace, account } = await this.requireContext(input.marketplaceId, input.workspaceId);
    const quotas = await this.quotaRepo.findByAccount({
      workspaceId: marketplace.workspaceId,
      marketplaceId: marketplace.id,
      marketplaceAccountId: account.id,
      limit: 100,
    });
    return quotas.map((quota) => this.presentQuota(quota));
  }

  async set(input: SetOlxQuotaInput): Promise<OlxQuotaView> {
    const { marketplace, account } = await this.requireContext(input.marketplaceId, input.workspaceId);
    const parsed = {
      cycleStartedAt: this.date(input.cycleStartedAt, 'cycleStartedAt'),
      cycleEndsAt: this.date(input.cycleEndsAt, 'cycleEndsAt'),
      verifiedAt: this.date(input.verifiedAt, 'verifiedAt'),
      staleAt: this.date(input.staleAt, 'staleAt'),
    };
    const created = OlxPublicationQuota.create({
      id: this.idGenerator(),
      workspaceId: marketplace.workspaceId,
      marketplaceId: marketplace.id,
      marketplaceAccountId: account.id,
      subcategoryId: input.subcategoryId,
      publicationLimit: input.publicationLimit,
      consumed: input.consumed,
      source: input.source,
      confidence: input.confidence,
      ...parsed,
    });
    if (created.isErr()) throw created.error;
    await this.quotaRepo.save(created.value);
    const saved = await this.quotaRepo.findCurrent({
      workspaceId: marketplace.workspaceId,
      marketplaceId: marketplace.id,
      marketplaceAccountId: account.id,
      subcategoryId: created.value.subcategoryId,
      at: parsed.cycleStartedAt,
    });
    if (!saved) throw new InvalidStateError('OLX quota was not persisted');

    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: marketplace.workspaceId,
      entityType: 'marketplace',
      entityId: marketplace.id,
      actorType: 'user',
      actorId: input.actorId,
      action: 'olx.quota_updated',
      metadata: {
        marketplaceAccountId: account.id,
        subcategoryId: saved.subcategoryId,
        cycleStartedAt: saved.cycleStartedAt.toISOString(),
        cycleEndsAt: saved.cycleEndsAt.toISOString(),
        publicationLimit: saved.publicationLimit,
        consumed: saved.consumed,
        source: saved.source,
        confidence: saved.confidence,
        verifiedAt: saved.verifiedAt.toISOString(),
        staleAt: saved.staleAt.toISOString(),
      },
      createdAt: this.now(),
    });
    return this.presentQuota(saved);
  }

  async preview(input: {
    listing: Listing;
    product: Product;
    marketplace: Marketplace;
  }): Promise<OlxQuotaDecisionView> {
    if (input.marketplace.key !== 'olx') return this.notApplicable();
    const account = await this.accountRepo.findByMarketplaceId(input.marketplace.id);
    if (!account || account.status !== 'connected') {
      return this.unknown('marketplace_account_unknown', undefined, undefined, false);
    }
    const subcategoryId = this.subcategories.resolve(input.product.category);
    if (!subcategoryId) {
      return this.unknown('olx_subcategory_unknown', account.id, undefined, false);
    }
    const at = this.now();
    const quota = await this.quotaRepo.findCurrent({
      workspaceId: input.product.workspaceId,
      marketplaceId: input.marketplace.id,
      marketplaceAccountId: account.id,
      subcategoryId,
      at,
    });
    if (!quota) return this.unknown('quota_unknown', account.id, subcategoryId);
    const evaluation = quota.evaluate(at);
    return {
      applicable: true,
      marketplaceKey: 'olx',
      marketplaceAccountId: account.id,
      subcategoryId,
      status: evaluation.status,
      decision: evaluation.canPublishForFree ? 'allow' : 'block',
      reason: evaluation.reason,
      requiresOverride: !evaluation.canPublishForFree,
      quota: this.presentQuota(quota),
    };
  }

  async authorize(input: {
    operationId: string;
    mode: 'publish' | 'relist';
    listing: Listing;
    product: Product;
    marketplace: Marketplace;
    actorId?: string;
    override?: OlxQuotaOverride;
  }): Promise<OlxQuotaDecisionView> {
    if (input.marketplace.key !== 'olx') return this.notApplicable();
    const account = await this.accountRepo.findByMarketplaceId(input.marketplace.id);
    const subcategoryId = this.subcategories.resolve(input.product.category);
    if (!account || account.status !== 'connected' || !subcategoryId) {
      const decision = this.unknown(
        !account || account.status !== 'connected'
          ? 'marketplace_account_unknown'
          : 'olx_subcategory_unknown',
        account?.id,
        subcategoryId ?? undefined,
        false,
      );
      await this.auditDecision(input, decision);
      return decision;
    }
    if (input.override && !input.actorId?.trim()) {
      throw new ValidationError('Quota override requires an authenticated operator');
    }
    if (input.override && !input.override.reason.trim()) {
      throw new ValidationError('Quota override requires a non-empty reason');
    }

    const authorization = await this.quotaRepo.authorize({
      operationId: input.operationId,
      workspaceId: input.product.workspaceId,
      marketplaceId: input.marketplace.id,
      marketplaceAccountId: account.id,
      subcategoryId,
      at: this.now(),
      listingId: input.listing.id,
      mode: input.mode,
      overrideConfirmed: input.override?.confirmed === true,
      overrideReason: input.override?.reason,
      actorId: input.actorId,
    });
    const decision = this.presentAuthorization(authorization, account.id, subcategoryId);
    await this.auditDecision(input, decision, input.override?.reason);
    return decision;
  }

  guardError(decision: OlxQuotaDecisionView): GuardrailViolationError {
    return new GuardrailViolationError(
      `OLX ${decision.status} quota blocks publication for subcategory ${decision.subcategoryId ?? 'unknown'}; ` +
        'verify quota or provide an explicit operation-scoped override',
      { quotaDecision: decision },
    );
  }

  private async requireContext(
    marketplaceId: string,
    workspaceId: string,
  ): Promise<{ marketplace: Marketplace; account: MarketplaceAccountRecord }> {
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(marketplaceId, workspaceId);
    if (!marketplace) throw new NotFoundError(`Marketplace not found: ${marketplaceId}`);
    if (marketplace.key !== 'olx') {
      throw new InvalidStateError('Publication quota is only supported for OLX');
    }
    const account = await this.accountRepo.findByMarketplaceId(marketplace.id);
    if (!account) throw new InvalidStateError('OLX account is not connected');
    return { marketplace, account };
  }

  private presentAuthorization(
    authorization: OlxPublicationAuthorization,
    accountId: string,
    subcategoryId: string,
  ): OlxQuotaDecisionView {
    return {
      applicable: true,
      marketplaceKey: 'olx',
      marketplaceAccountId: accountId,
      subcategoryId,
      status: authorization.status,
      decision: authorization.decision,
      reason: authorization.reason,
      requiresOverride: authorization.decision === 'block',
      consumedUnit: authorization.consumedUnit,
      ...(authorization.quota ? { quota: this.presentQuota(authorization.quota) } : {}),
    };
  }

  private presentQuota(quota: OlxPublicationQuota): OlxQuotaView {
    const now = this.now();
    return {
      id: quota.id,
      workspaceId: quota.workspaceId,
      marketplaceId: quota.marketplaceId,
      marketplaceAccountId: quota.marketplaceAccountId,
      subcategoryId: quota.subcategoryId,
      cycleStartedAt: quota.cycleStartedAt.toISOString(),
      cycleEndsAt: quota.cycleEndsAt.toISOString(),
      publicationLimit: quota.publicationLimit,
      consumed: quota.consumed,
      remaining: quota.remaining,
      source: quota.source,
      confidence: quota.confidence,
      verifiedAt: quota.verifiedAt.toISOString(),
      staleAt: quota.staleAt.toISOString(),
      isStale: now.getTime() >= quota.staleAt.getTime() || now.getTime() >= quota.cycleEndsAt.getTime(),
      status: quota.evaluate(now).status,
    };
  }

  private unknown(
    reason: string,
    accountId?: string,
    subcategoryId?: string,
    requiresOverride = true,
  ): OlxQuotaDecisionView {
    return {
      applicable: true,
      marketplaceKey: 'olx',
      marketplaceAccountId: accountId,
      subcategoryId,
      status: 'unknown',
      decision: 'block',
      reason,
      requiresOverride,
    };
  }

  private notApplicable(): OlxQuotaDecisionView {
    return {
      applicable: false,
      marketplaceKey: null,
      status: 'not_applicable',
      decision: 'not_applicable',
      reason: 'non_olx_marketplace',
      requiresOverride: false,
    };
  }

  private async auditDecision(
    input: {
      operationId: string;
      mode: 'publish' | 'relist';
      listing: Listing;
      product: Product;
      marketplace: Marketplace;
      actorId?: string;
    },
    decision: OlxQuotaDecisionView,
    overrideReason?: string,
  ): Promise<void> {
    const action = decision.decision === 'allow'
      ? 'olx.quota_publish_allowed'
      : decision.decision === 'override'
        ? 'olx.quota_publish_overridden'
        : 'olx.quota_publish_blocked';
    await this.activityLog.record({
      id: this.idGenerator(),
      workspaceId: input.product.workspaceId,
      entityType: 'listing',
      entityId: input.listing.id,
      actorType: 'user',
      actorId: input.actorId,
      action,
      metadata: {
        operationId: input.operationId,
        mode: input.mode,
        marketplaceId: input.marketplace.id,
        marketplaceAccountId: decision.marketplaceAccountId,
        subcategoryId: decision.subcategoryId,
        quotaStatus: decision.status,
        quotaDecision: decision.decision,
        reason: decision.reason,
        consumedUnit: decision.consumedUnit ?? false,
        overrideReason,
        quota: decision.quota,
      },
      createdAt: this.now(),
    });
  }

  private date(value: string, name: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${name} must be an ISO date-time`);
    return parsed;
  }
}
