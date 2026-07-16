import { OlxPublicationQuotaService } from '../OlxPublicationQuotaService';
import { decideOlxPublication, OlxPublicationQuota } from '../../../domain/entities/OlxPublicationQuota';
import type {
  AuthorizeOlxPublicationInput,
  IOlxPublicationQuotaRepository,
  OlxPublicationAuthorization,
  OlxQuotaLookup,
} from '../../../domain/repositories/interfaces/IOlxPublicationQuotaRepository';
import type { MarketplaceAccountRepository } from '../MarketplaceOAuthService';
import {
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

class AtomicInMemoryQuotaRepository implements IOlxPublicationQuotaRepository {
  readonly quotas: OlxPublicationQuota[] = [];
  readonly operations = new Map<string, OlxPublicationAuthorization>();
  private tail: Promise<void> = Promise.resolve();

  async findCurrent(input: OlxQuotaLookup): Promise<OlxPublicationQuota | null> {
    return this.quotas.find((quota) =>
      quota.workspaceId === input.workspaceId &&
      quota.marketplaceId === input.marketplaceId &&
      quota.marketplaceAccountId === input.marketplaceAccountId &&
      quota.subcategoryId === input.subcategoryId &&
      quota.cycleStartedAt.getTime() <= input.at.getTime() &&
      quota.cycleEndsAt.getTime() > input.at.getTime()
    ) ?? null;
  }

  async findByAccount(input: {
    workspaceId: string;
    marketplaceId: string;
    marketplaceAccountId: string;
    limit: number;
  }): Promise<OlxPublicationQuota[]> {
    return this.quotas.filter((quota) =>
      quota.workspaceId === input.workspaceId &&
      quota.marketplaceId === input.marketplaceId &&
      quota.marketplaceAccountId === input.marketplaceAccountId
    );
  }

  async save(quota: OlxPublicationQuota): Promise<void> {
    const index = this.quotas.findIndex((candidate) =>
      candidate.workspaceId === quota.workspaceId &&
      candidate.marketplaceAccountId === quota.marketplaceAccountId &&
      candidate.subcategoryId === quota.subcategoryId &&
      candidate.cycleStartedAt.getTime() === quota.cycleStartedAt.getTime()
    );
    if (index < 0) {
      this.quotas.push(quota);
      return;
    }
    const current = this.quotas[index];
    this.quotas[index] = this.copy(quota, Math.max(current.consumed, quota.consumed));
  }

  async authorize(input: AuthorizeOlxPublicationInput): Promise<OlxPublicationAuthorization> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const replay = this.operations.get(input.operationId);
      if (replay) return { ...replay, replayed: true };
      let quota = await this.findCurrent(input);
      const evaluation = quota?.evaluate(input.at);
      const { decision, consumedUnit } = decideOlxPublication(
        evaluation,
        input.overrideConfirmed,
        quota !== null,
      );
      if (consumedUnit && quota) {
        quota = this.copy(quota, quota.consumed + 1);
        const index = this.quotas.findIndex((candidate) => candidate.id === quota!.id);
        this.quotas[index] = quota;
      }
      const result: OlxPublicationAuthorization = {
        operationId: input.operationId,
        decision,
        status: evaluation?.status ?? 'unknown',
        reason: evaluation?.reason ?? 'quota_unknown',
        quota,
        consumedUnit,
        replayed: false,
      };
      this.operations.set(input.operationId, result);
      return result;
    } finally {
      release();
    }
  }

  private copy(quota: OlxPublicationQuota, consumed: number): OlxPublicationQuota {
    return unwrap(OlxPublicationQuota.create({
      id: quota.id,
      workspaceId: quota.workspaceId,
      marketplaceId: quota.marketplaceId,
      marketplaceAccountId: quota.marketplaceAccountId,
      subcategoryId: quota.subcategoryId,
      cycleStartedAt: quota.cycleStartedAt,
      cycleEndsAt: quota.cycleEndsAt,
      publicationLimit: quota.publicationLimit,
      consumed,
      source: quota.source,
      confidence: quota.confidence,
      verifiedAt: quota.verifiedAt,
      staleAt: quota.staleAt,
      createdAt: quota.createdAt,
      updatedAt: new Date(),
    }));
  }
}

const NOW = new Date('2026-07-15T12:00:00.000Z');

function setup() {
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const quotaRepo = new AtomicInMemoryQuotaRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const accountRepo: MarketplaceAccountRepository = {
    findByMarketplaceId: async (marketplaceId) => marketplaceId === 'mp-1'
      ? {
          id: 'account-1',
          marketplaceId,
          handle: 'OLX account',
          credentials: {},
          status: 'connected',
          scopes: [],
          createdAt: NOW,
          updatedAt: NOW,
        }
      : marketplaceId === 'mp-2'
        ? {
            id: 'account-2',
            marketplaceId,
            handle: 'Other account',
            credentials: {},
            status: 'connected',
            scopes: [],
            createdAt: NOW,
            updatedAt: NOW,
          }
        : null,
    upsert: async () => { throw new Error('not used'); },
    updateConnectedIfUnchanged: async () => { throw new Error('not used'); },
  };
  const marketplace = unwrap(Marketplace.create({
    id: 'mp-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true,
  }));
  const otherMarketplace = unwrap(Marketplace.create({
    id: 'mp-2', workspaceId: 'ws-2', key: 'olx', name: 'OLX', connected: true,
  }));
  marketplaceRepo.items.set(marketplace.id, marketplace);
  marketplaceRepo.items.set(otherMarketplace.id, otherMarketplace);

  const product = unwrap(Product.create({
    id: 'product-1',
    workspaceId: 'ws-1',
    sku: 'SKU-1',
    name: 'Camera',
    description: 'A camera with enough detail for a safe OLX publication.',
    costPrice: money(100),
    sellingPrice: money(200),
    condition: 'good',
    category: 'electronics',
  }));
  const listing = unwrap(Listing.create({
    id: 'listing-1', productId: product.id, marketplaceId: marketplace.id, price: money(200),
  }));
  const service = new OlxPublicationQuotaService(
    marketplaceRepo,
    accountRepo,
    quotaRepo,
    activityLog,
    idFactory('id'),
    { resolve: (category) => category === 'electronics' ? '2000' : null },
    () => NOW,
  );
  return { service, quotaRepo, activityLog, marketplace, product, listing };
}

function quota(consumed: number, options: { stale?: boolean; confidence?: 'verified' | 'estimated' } = {}) {
  return unwrap(OlxPublicationQuota.create({
    id: `quota-${consumed}`,
    workspaceId: 'ws-1',
    marketplaceId: 'mp-1',
    marketplaceAccountId: 'account-1',
    subcategoryId: '2000',
    cycleStartedAt: new Date('2026-07-01T00:00:00.000Z'),
    cycleEndsAt: new Date('2026-08-01T00:00:00.000Z'),
    publicationLimit: 1,
    consumed,
    source: 'operator',
    confidence: options.confidence ?? 'verified',
    verifiedAt: new Date('2026-07-14T00:00:00.000Z'),
    staleAt: options.stale
      ? new Date('2026-07-15T11:00:00.000Z')
      : new Date('2026-07-20T00:00:00.000Z'),
  }));
}

describe('OlxPublicationQuotaService', () => {
  it('fails closed and reports an actionable unknown decision when no quota exists', async () => {
    const { service, marketplace, product, listing } = setup();

    const preview = await service.preview({ marketplace, product, listing });
    const decision = await service.authorize({
      operationId: 'operation-1', mode: 'publish', marketplace, product, listing, actorId: 'user-1',
    });

    expect(preview).toMatchObject({
      status: 'unknown', decision: 'block', reason: 'quota_unknown', requiresOverride: true,
    });
    expect(decision).toMatchObject({
      status: 'unknown', decision: 'block', reason: 'quota_unknown', requiresOverride: true,
    });
  });

  it('does not advertise overrides for unknown accounts or OLX subcategories', async () => {
    const { service, marketplace, product, listing } = setup();
    const missingAccountMarketplace = unwrap(Marketplace.create({
      id: 'mp-missing', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected: true,
    }));
    const unknownCategoryProduct = unwrap(Product.create({
      id: 'product-unknown-category', workspaceId: 'ws-1', sku: 'SKU-2', name: 'Table',
      description: 'A table with enough detail for a safe OLX publication.',
      costPrice: money(100), sellingPrice: money(200), condition: 'good', category: 'furniture',
    }));

    await expect(service.preview({
      marketplace: missingAccountMarketplace, product, listing,
    })).resolves.toMatchObject({ reason: 'marketplace_account_unknown', requiresOverride: false });
    await expect(service.preview({
      marketplace, product: unknownCategoryProduct, listing,
    })).resolves.toMatchObject({ reason: 'olx_subcategory_unknown', requiresOverride: false });
  });

  it('serializes concurrent attempts so only one consumes the final free unit', async () => {
    const { service, quotaRepo, marketplace, product, listing } = setup();
    await quotaRepo.save(quota(0));

    const decisions = await Promise.all([
      service.authorize({
        operationId: 'operation-a', mode: 'publish', marketplace, product, listing, actorId: 'user-1',
      }),
      service.authorize({
        operationId: 'operation-b', mode: 'publish', marketplace, product, listing, actorId: 'user-2',
      }),
    ]);

    expect(decisions.map((decision) => decision.decision).sort()).toEqual(['allow', 'block']);
    expect(decisions.filter((decision) => decision.consumedUnit)).toHaveLength(1);
    expect((await quotaRepo.findCurrent({
      workspaceId: 'ws-1', marketplaceId: 'mp-1', marketplaceAccountId: 'account-1',
      subcategoryId: '2000', at: NOW,
    }))?.consumed).toBe(1);
  });

  it.each([
    ['stale', quota(0, { stale: true })],
    ['unverified', quota(0, { confidence: 'estimated' })],
    ['exhausted', quota(1)],
  ])('blocks %s quota without an override', async (status, storedQuota) => {
    const { service, quotaRepo, marketplace, product, listing } = setup();
    await quotaRepo.save(storedQuota);

    const decision = await service.authorize({
      operationId: `operation-${status}`, mode: 'publish', marketplace, product, listing, actorId: 'user-1',
    });

    expect(decision).toMatchObject({ status, decision: 'block', requiresOverride: true });
  });

  it('allows only an explicit operation-scoped override and audits its reason', async () => {
    const { service, quotaRepo, activityLog, marketplace, product, listing } = setup();
    await quotaRepo.save(quota(1));

    const decision = await service.authorize({
      operationId: 'operation-override',
      mode: 'relist',
      marketplace,
      product,
      listing,
      actorId: 'operator-1',
      override: { confirmed: true, reason: 'Operator accepts possible OLX publication fee' },
    });

    expect(decision).toMatchObject({ status: 'exhausted', decision: 'override', consumedUnit: true });
    expect(decision.quota?.consumed).toBe(2);
    expect(activityLog.entries.at(-1)).toMatchObject({
      action: 'olx.quota_publish_overridden',
      actorId: 'operator-1',
      metadata: expect.objectContaining({
        operationId: 'operation-override',
        mode: 'relist',
        overrideReason: 'Operator accepts possible OLX publication fee',
      }),
    });
  });

  it.each(['', '   '])('rejects a blank override reason (%p)', async (reason) => {
    const { service, marketplace, product, listing } = setup();

    await expect(service.authorize({
      operationId: 'operation-blank-reason', mode: 'publish', marketplace, product, listing,
      actorId: 'operator-1', override: { confirmed: true, reason },
    })).rejects.toThrow('Quota override requires a non-empty reason');
  });

  it('records an override without consumption when no quota row exists', async () => {
    const { service, marketplace, product, listing } = setup();

    const decision = await service.authorize({
      operationId: 'operation-no-quota-override', mode: 'publish', marketplace, product, listing,
      actorId: 'operator-1', override: { confirmed: true, reason: 'Operator accepts paid publication' },
    });

    expect(decision).toMatchObject({ status: 'unknown', decision: 'override', consumedUnit: false });
    expect(decision.quota).toBeUndefined();
  });

  it.each(['cycleStartedAt', 'cycleEndsAt', 'verifiedAt', 'staleAt'] as const)(
    'rejects an invalid %s date',
    (field) => {
      const props = {
        id: 'quota-invalid-date', workspaceId: 'ws-1', marketplaceId: 'mp-1',
        marketplaceAccountId: 'account-1', subcategoryId: '2000',
        cycleStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        cycleEndsAt: new Date('2026-08-01T00:00:00.000Z'), publicationLimit: 1, consumed: 0,
        source: 'operator' as const, confidence: 'verified' as const,
        verifiedAt: new Date('2026-07-14T00:00:00.000Z'),
        staleAt: new Date('2026-07-20T00:00:00.000Z'),
      };
      const result = OlxPublicationQuota.create({ ...props, [field]: new Date('invalid') });
      expect(result.isErr()).toBe(true);
    },
  );

  it('fails closed when quota evaluation receives an invalid current date', () => {
    expect(quota(0).evaluate(new Date('invalid'))).toEqual({
      status: 'stale', canPublishForFree: false, reason: 'outside_cycle',
    });
  });

  it('isolates quota reads by workspace and account', async () => {
    const { service, quotaRepo } = setup();
    await quotaRepo.save(quota(0));

    await expect(service.list({ marketplaceId: 'mp-2', workspaceId: 'ws-1' }))
      .rejects.toThrow('Marketplace not found');
    expect(await service.list({ marketplaceId: 'mp-1', workspaceId: 'ws-1' })).toHaveLength(1);
  });

  it('sets and reads operator quota without permitting consumed to decrease in-cycle', async () => {
    const { service } = setup();
    const base = {
      marketplaceId: 'mp-1',
      workspaceId: 'ws-1',
      actorId: 'operator-1',
      subcategoryId: '2000',
      cycleStartedAt: '2026-07-01T00:00:00.000Z',
      cycleEndsAt: '2026-08-01T00:00:00.000Z',
      publicationLimit: 5,
      source: 'operator' as const,
      confidence: 'verified' as const,
      verifiedAt: '2026-07-14T00:00:00.000Z',
      staleAt: '2026-07-20T00:00:00.000Z',
    };
    await service.set({ ...base, consumed: 3 });
    const updated = await service.set({ ...base, consumed: 1 });

    expect(updated.consumed).toBe(3);
    expect(updated.remaining).toBe(2);
    expect(await service.list({ marketplaceId: 'mp-1', workspaceId: 'ws-1' })).toHaveLength(1);
  });
});
