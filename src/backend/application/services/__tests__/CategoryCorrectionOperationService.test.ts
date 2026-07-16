import { CategoryCorrectionOperationService } from '../CategoryCorrectionOperationService';
import type {
  CategoryCorrectionOperation,
  ICategoryCorrectionOperationRepository,
} from '../../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';
import type { IMarketplaceAdapter } from '../../../domain/services/MarketplaceAdapter';
import type { OlxPublicationQuotaService } from '../OlxPublicationQuotaService';
import {
  InMemoryEventRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import { InMemoryActivityLogRepository, idFactory } from '../../testkit/support';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { GuardrailViolationError } from '../../../domain/shared/DomainError';
import type { HermesEventView } from '../../dto/presenters';

const now = new Date('2026-07-16T12:00:00.000Z');
const category: MarketplaceCategoryMetadata = {
  providerCategoryId: 'projectors-123', name: 'Projectors',
  path: ['Electronics', 'Video', 'Projectors'], source: 'provider_taxonomy',
  confidence: 0.99, isLeaf: true, taxonomyVerifiedAt: '2026-07-16T00:00:00.000Z',
  taxonomyStaleAt: '2026-07-17T00:00:00.000Z',
};

class InMemoryOperations implements ICategoryCorrectionOperationRepository {
  readonly items = new Map<string, CategoryCorrectionOperation>();
  async createPair(delist: CategoryCorrectionOperation, recreate: CategoryCorrectionOperation) {
    this.items.set(delist.id, delist); this.items.set(recreate.id, recreate);
  }
  async findByIdForWorkspace(id: string, workspaceId: string) {
    const value = this.items.get(id); return value?.workspaceId === workspaceId ? value : null;
  }
  async findByRecommendationForWorkspace(id: string, workspaceId: string) {
    return [...this.items.values()].filter((value) => value.recommendationEventId === id && value.workspaceId === workspaceId);
  }
  async approve(input: { id: string; workspaceId: string; actorId: string; paidOverrideReason?: string; targetCategory?: MarketplaceCategoryMetadata; at: Date }) {
    const value = await this.findByIdForWorkspace(input.id, input.workspaceId);
    if (!value || value.state !== 'requested') return value;
    Object.assign(value, { state: 'approved', approvedBy: input.actorId, approvedAt: input.at,
      paidOverrideReason: input.paidOverrideReason ?? null, targetCategory: input.targetCategory ?? value.targetCategory,
      updatedAt: input.at });
    return value;
  }
  async claimApproved(id: string, workspaceId: string, at: Date) {
    const value = await this.findByIdForWorkspace(id, workspaceId);
    if (!value || value.state !== 'approved') return null;
    Object.assign(value, { state: 'executing', updatedAt: at }); return value;
  }
  async releaseToApproved(id: string, workspaceId: string, result: Record<string, unknown>, at: Date) {
    const value = await this.findByIdForWorkspace(id, workspaceId);
    if (!value || value.state !== 'executing') return null;
    Object.assign(value, { state: 'approved', result, updatedAt: at }); return value;
  }
  async markExecuted(id: string, workspaceId: string, result: Record<string, unknown>, at: Date) {
    return this.finish(id, workspaceId, 'executed', result, at);
  }
  async markFailed(id: string, workspaceId: string, result: Record<string, unknown>, at: Date) {
    return this.finish(id, workspaceId, 'failed', result, at);
  }
  private async finish(id: string, workspaceId: string, state: 'executed' | 'failed', result: Record<string, unknown>, at: Date) {
    const value = await this.findByIdForWorkspace(id, workspaceId);
    if (!value || value.state !== 'executing') return value;
    Object.assign(value, { state, result, updatedAt: at,
      executedAt: state === 'executed' ? at : null, failedAt: state === 'failed' ? at : null });
    return value;
  }
}

function operation(kind: 'delist' | 'recreate'): CategoryCorrectionOperation {
  return {
    id: `${kind}-1`, workspaceId: 'ws-1', recommendationEventId: 'event-1', listingId: 'listing-1',
    marketplaceId: 'marketplace-1', kind, state: 'requested', targetCategory: kind === 'recreate' ? category : null,
    paidOverrideReason: null, requestedBy: null, approvedBy: null, result: null, requestedAt: now,
    approvedAt: null, executedAt: null, failedAt: null, updatedAt: now,
  };
}

function setup(decision: 'allow' | 'block' | 'override' = 'allow') {
  const operations = new InMemoryOperations();
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const activity = new InMemoryActivityLogRepository();
  const product = unwrap(Product.create({ id: 'product-1', workspaceId: 'ws-1', sku: 'P1',
    name: 'AOPEN QH11 projector', description: 'LED HD projector in very good working condition.',
    costPrice: money(100), sellingPrice: money(299), condition: 'good', category: 'electronics', images: ['image.jpg'] }));
  const marketplace = unwrap(Marketplace.create({ id: 'marketplace-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true }));
  const listing = unwrap(Listing.create({ id: 'listing-1', productId: product.id, marketplaceId: marketplace.id,
    price: money(299), status: 'live', marketplaceListingId: 'old-advert-1', marketplaceCategory: category }));
  productRepo.items.set(product.id, product); marketplaceRepo.items.set(marketplace.id, marketplace); listingRepo.items.set(listing.id, listing);
  const publish = jest.fn(async () => ({ externalListingId: 'new-advert-1', externalUrl: 'https://example/new', publishedAt: now }));
  const delist = jest.fn(async () => undefined);
  const adapter = { publish, delist } as unknown as IMarketplaceAdapter;
  const resolveAdapter = jest.fn(async () => adapter);
  const authorize = jest.fn(async (input: { override?: unknown }) => ({
    applicable: true, marketplaceKey: 'olx' as const, status: decision === 'block' ? 'unknown' as const : 'available' as const,
    decision, reason: decision === 'block' ? 'quota_unknown' : 'free_unit_available', requiresOverride: decision === 'block',
    consumedUnit: decision !== 'block', subcategoryId: category.providerCategoryId,
  }));
  const quota = { authorize, guardError: (quotaDecision: unknown) => new GuardrailViolationError('quota blocked', { quotaDecision }) } as unknown as OlxPublicationQuotaService;
  const publishAttempts = {
    begin: jest.fn(async () => ({
      created: true,
      checkpoint: { operationId: 'recreate-1', status: 'publishing' as const, externalListingId: null,
        externalUrl: null, publishedAt: null, remoteStatus: null },
    })),
    markPublished: jest.fn(async () => undefined),
    markFinalized: jest.fn(async () => undefined),
    markAbandoned: jest.fn(async () => undefined),
  };
  const service = new CategoryCorrectionOperationService(operations, new InMemoryEventRepository(), listingRepo,
    productRepo, marketplaceRepo, quota, { resolve: resolveAdapter }, activity, idFactory('audit'), publishAttempts, () => now);
  return { service, operations, authorize, publish, delist, resolveAdapter, activity, listing, listingRepo, publishAttempts };
}

async function addAndApprove(setupResult: ReturnType<typeof setup>, kind: 'delist' | 'recreate', paidOverrideReason?: string) {
  if (kind === 'recreate') {
    const delist = operation('delist');
    delist.state = 'executed'; delist.approvedAt = now; delist.executedAt = now;
    delist.result = { externalListingId: setupResult.listing.marketplaceListingId };
    setupResult.listing.expire();
    setupResult.operations.items.set(delist.id, delist);
  }
  const value = operation(kind); setupResult.operations.items.set(value.id, value);
  return setupResult.service.approve({ operationId: value.id, workspaceId: 'ws-1', actorId: 'user-1', paidOverrideReason });
}

describe('CategoryCorrectionOperationService', () => {
  it('delists once, records zero restored quota, and replays the terminal result idempotently', async () => {
    const context = setup(); await addAndApprove(context, 'delist');
    const first = await context.service.execute({ operationId: 'delist-1', workspaceId: 'ws-1', actorId: 'user-1' });
    const retry = await context.service.execute({ operationId: 'delist-1', workspaceId: 'ws-1', actorId: 'user-1' });
    expect(context.delist).toHaveBeenCalledTimes(1); expect(context.authorize).not.toHaveBeenCalled();
    expect(first).toMatchObject({ state: 'executed', result: { quotaUnitsRestored: 0, deletionRestoresQuota: false } });
    expect(context.listing.status).toBe('expired');
    expect(retry).toBe(first);
  });

  it('calls recreate quota authorization before publish and does not repeat publish on retry', async () => {
    const context = setup('allow'); await addAndApprove(context, 'recreate');
    await context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' });
    await context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' });
    expect(context.authorize).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'recreate-1', mode: 'recreate' }));
    expect(context.authorize.mock.invocationCallOrder[0]).toBeLessThan(context.publish.mock.invocationCallOrder[0]);
    expect(context.publish).toHaveBeenCalledTimes(1);
    expect(context.listing.marketplaceListingId).toBe('new-advert-1');
    expect(context.listing.status).toBe('live');
  });

  it('blocks recreate until the paired delist has executed', async () => {
    const context = setup();
    const recreate = operation('recreate'); context.operations.items.set(recreate.id, recreate);
    await context.service.approve({ operationId: recreate.id, workspaceId: 'ws-1', actorId: 'user-1' });
    await expect(context.service.execute({ operationId: recreate.id, workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('paired delist');
    expect(context.publish).not.toHaveBeenCalled();
  });

  it('hydrates event actions from durable operation state and real backend routes', async () => {
    const context = setup();
    const delist = operation('delist'); const recreate = operation('recreate');
    context.operations.items.set(delist.id, delist); context.operations.items.set(recreate.id, recreate);
    const event = {
      id: 'event-1', workspaceId: 'ws-1', productId: 'product-1', type: 'olx_category_mismatch',
      severity: 'critical', status: 'pending_review', title: 'Category mismatch',
      proposedChange: {
        kind: 'category_recreation', listingId: 'listing-1', currentCategory: category,
        proposedCategory: category,
        operations: [
          { kind: 'delist', intentId: 'stale-delist', status: 'pending_review', providerSideEffectAllowed: false, quotaUnitsRestored: 0 },
          { kind: 'recreate', intentId: 'stale-recreate', status: 'pending_review', providerSideEffectAllowed: false, quotaGuardRequired: true },
        ],
      },
      createdAt: now.toISOString(),
    } satisfies HermesEventView;
    const hydrated = await context.service.hydrateEvent(event, 'ws-1');
    expect(hydrated.proposedChange).toMatchObject({ operations: [
      { intentId: 'delist-1', availableActions: [{ href: '/hermes/category-correction-operations/delist-1/approve' }] },
      { intentId: 'recreate-1', availableActions: [{ href: '/hermes/category-correction-operations/recreate-1/approve' }] },
    ] });
  });

  it('releases the publication fence when the listing generation changes before provider publish', async () => {
    const context = setup('allow');
    await addAndApprove(context, 'recreate');
    const changed = unwrap(Listing.create({
      id: 'listing-1', productId: 'product-1', marketplaceId: 'marketplace-1', price: money(299),
      status: 'expired', marketplaceListingId: 'old-advert-1', marketplaceCategory: category,
      updatedAt: new Date(context.listing.updatedAt.getTime() + 1),
    }));
    jest.spyOn(context.listingRepo, 'findByIdForWorkspace')
      .mockResolvedValueOnce(context.listing)
      .mockResolvedValueOnce(changed);

    await expect(context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('Listing changed while recreate publication was being reserved');
    expect(context.authorize).not.toHaveBeenCalled();
    expect(context.publish).not.toHaveBeenCalled();
    expect(context.publishAttempts.markAbandoned).toHaveBeenCalledWith('recreate-1');
  });

  it('persists the provider identity in failure evidence when local relinking fails', async () => {
    const context = setup('allow'); await addAndApprove(context, 'recreate');
    jest.spyOn(context.listingRepo, 'save').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('database unavailable');
    expect(context.operations.items.get('recreate-1')).toMatchObject({
      state: 'failed',
      result: { providerEffect: 'published', externalListingId: 'new-advert-1', manualReconciliationRequired: true },
    });
  });

  it('fails closed on unknown quota before any provider effect', async () => {
    const context = setup('block'); await addAndApprove(context, 'recreate');
    await expect(context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('quota blocked');
    expect(context.publish).not.toHaveBeenCalled();
    expect(context.resolveAdapter).not.toHaveBeenCalled();
    expect(context.publishAttempts.markAbandoned).toHaveBeenCalledWith('recreate-1');
    expect(context.operations.items.get('recreate-1')).toMatchObject({
      state: 'approved', result: { retrySafe: true, manualReconciliationRequired: false },
    });
  });

  it('keeps a recovered provider checkpoint out of the retryable quota-denial path', async () => {
    const context = setup('unknown');
    await addAndApprove(context, 'recreate');
    context.publishAttempts.begin.mockResolvedValueOnce({
      created: false,
      checkpoint: {
        operationId: 'recreate-1', status: 'published', externalListingId: 'new-advert-1',
        externalUrl: 'https://olx.example/new-advert-1', publishedAt: now, remoteStatus: 'active',
      },
    });

    await expect(context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('quota blocked');
    expect(context.publish).not.toHaveBeenCalled();
    expect(context.operations.items.get('recreate-1')).toMatchObject({
      state: 'failed',
      result: {
        providerEffect: 'published', externalListingId: 'new-advert-1',
        manualReconciliationRequired: true,
      },
    });
  });

  it('uses only the persisted operation-scoped paid-risk override', async () => {
    const context = setup('override');
    await addAndApprove(context, 'recreate', 'Operator accepts possible paid OLX placement');
    await context.service.execute({ operationId: 'recreate-1', workspaceId: 'ws-1', actorId: 'user-1' });
    expect(context.authorize).toHaveBeenCalledWith(expect.objectContaining({
      override: { confirmed: true, reason: 'Operator accepts possible paid OLX placement' },
    }));
    expect(context.publish).toHaveBeenCalledTimes(1);
  });

  it('never re-enters an executing operation after an interrupted effect boundary', async () => {
    const context = setup(); const value = operation('recreate'); value.state = 'executing'; value.approvedAt = now;
    context.operations.items.set(value.id, value);
    await expect(context.service.execute({ operationId: value.id, workspaceId: 'ws-1', actorId: 'user-1' }))
      .rejects.toThrow('manual reconciliation');
    expect(context.authorize).not.toHaveBeenCalled(); expect(context.publish).not.toHaveBeenCalled();
  });
});
