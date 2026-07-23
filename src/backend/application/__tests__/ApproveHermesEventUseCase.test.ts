import { ApproveHermesEventUseCase } from '../usecases/ApproveHermesEventUseCase';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  unwrap,
  money,
} from '../../domain/testkit/support';
import {
  InMemoryActivityLogRepository,
  RecordingPriceHistoryRecorder,
  RecordingJobQueue,
  idFactory,
} from '../testkit/support';
import type { PublishListingJob } from '../ports/IJobQueue';
import type { OlxPublicationQuotaService } from '../services/OlxPublicationQuotaService';
import { GuardrailViolationError } from '../../domain/shared/DomainError';
import {
  recommendationFingerprint,
  seoSourceFingerprint,
} from '../../domain/agents/MarketDeskAgentCatalog';

function makeProduct() {
  return unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Lamp',
      description: 'A beautiful vintage brass lamp in excellent condition.',
      costPrice: money(50),
      sellingPrice: money(100),
      condition: 'good',
      category: 'home',
    })
  );
}

function makeListing() {
  return unwrap(
    Listing.create({
      id: 'lst-1',
      productId: 'prod-1',
      marketplaceId: 'mp-1',
      price: money(100),
    })
  );
}

function listingSeoSourceFor(product: Product, listing: Listing | null = null): string {
  return seoSourceFingerprint({
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      condition: product.condition,
      tags: [...product.tags],
      imageCount: product.imageCount,
    },
    listing: listing
      ? {
          id: listing.id,
          title: product.name,
          description: product.description,
          marketplace: listing.marketplaceId,
        }
      : null,
  });
}

function listingSeoRecommendationFingerprint(source: string, value: string): string {
  return recommendationFingerprint('listing-seo', '1.0.0', source, value);
}

function setup(
  accountStatus: 'connected' | 'missing' = 'connected',
  olxQuota?: OlxPublicationQuotaService
) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const eventRepo = new InMemoryEventRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const priceHistory = new RecordingPriceHistoryRecorder();
  const publishQueue = new RecordingJobQueue<PublishListingJob>();
  const publisher = new RecordingEventPublisher();

  const product = makeProduct();
  const listing = makeListing();
  const marketplace = unwrap(
    Marketplace.create({
      id: 'mp-1',
      workspaceId: 'ws-1',
      key: 'olx',
      name: 'OLX',
      connected: true,
    })
  );
  productRepo.items.set(product.id, product);
  listingRepo.items.set(listing.id, listing);
  marketplaceRepo.items.set(marketplace.id, marketplace);
  const accountStatuses = new Map<string, 'connected' | 'missing'>([
    [marketplace.id, accountStatus],
  ]);
  const accountRepo = {
    findByMarketplaceId: async (marketplaceId: string) =>
      accountStatuses.get(marketplaceId) === 'connected'
        ? {
            id: 'account-1',
            marketplaceId,
            handle: 'OLX account',
            credentials: {},
            status: 'connected' as const,
            scopes: ['basic'],
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
    upsert: async () => {
      throw new Error('not used');
    },
    updateConnectedIfUnchanged: async () => {
      throw new Error('not used');
    },
  };

  const useCase = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    activityLog,
    priceHistory,
    publishQueue,
    publisher,
    idFactory('rec'),
    accountRepo,
    olxQuota
  );

  return {
    useCase,
    productRepo,
    eventRepo,
    activityLog,
    priceHistory,
    publisher,
    product,
    listingRepo,
    marketplaceRepo,
    accountStatuses,
    publishQueue,
  };
}

describe('ApproveHermesEventUseCase', () => {
  it('applies a pending price change: updates product, records history and marks applied', async () => {
    const { useCase, eventRepo, product, priceHistory, activityLog, publisher } = setup();

    const event = unwrap(
      HermesEvent.create({
        id: 'evt-1',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        detail: 'Move stock faster',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: 'evt-1',
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    const applied = unwrap(result);
    expect(applied.status).toBe('applied');
    expect(applied.resolvedAt).not.toBeNull();
    expect(product.sellingPrice.amount).toBe(90);
    expect(priceHistory.records).toHaveLength(1);
    expect(priceHistory.records[0]).toMatchObject({
      listingId: 'lst-1',
      oldPrice: 100,
      newPrice: 90,
      changedBy: 'hermes',
    });
    expect(activityLog.entries.map((e) => e.action)).toContain('hermes_event.approved');
    expect(publisher.published.map((e) => e.type)).toContain('hermes.event.applied');
  });

  it('queues marketplace updates for approved title changes on live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-123',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-title',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Better Lamp' },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0]).toMatchObject({
      options: { jobId: 'update:rec-1' },
      data: {
        operationId: 'rec-1',
        mode: 'update',
        listingId: 'lst-live',
        marketplaceId: 'mp-1',
        changes: { productName: 'Better Lamp' },
        input: expect.objectContaining({ productName: 'Better Lamp' }),
      },
    });
    expect(activityLog.entries[0].metadata.marketplaceSync).toMatchObject({
      status: 'queued',
      operations: [expect.objectContaining({ operationId: 'rec-1', listingId: 'lst-live' })],
    });
  });

  it('queues marketplace updates for approved descriptions on live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-description',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-desc',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const description = 'A richer product description for buyers.';
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-description-live',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve description',
        proposedChange: {
          kind: 'description',
          field: 'description',
          from: 'Old description',
          to: description,
        },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs[0].data).toMatchObject({
      mode: 'update',
      listingId: 'lst-live-description',
      changes: { description },
    });
    expect(activityLog.entries[0].metadata.marketplaceSync).toMatchObject({ status: 'queued' });
  });

  it.each([
    {
      field: 'title' as const,
      eventId: 'evt-listing-seo-title',
      proposedChange: {
        kind: 'title' as const,
        field: 'title' as const,
        from: 'Lamp',
        to: 'Better Lamp',
      },
    },
    {
      field: 'description' as const,
      eventId: 'evt-listing-seo-description',
      proposedChange: {
        kind: 'description' as const,
        field: 'description' as const,
        from: 'A beautiful vintage brass lamp in excellent condition.',
        to: 'A richer product description for buyers.',
      },
    },
  ])(
    'applies listing-seo $field approvals to product and live listing',
    async ({ eventId, proposedChange }) => {
      const { useCase, eventRepo, productRepo, product, listingRepo, publishQueue, activityLog } =
        setup();
      const saveProduct = jest.spyOn(productRepo, 'save');
      const liveListing = unwrap(
        Listing.create({
          id: `${eventId}-live`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `${eventId}-olx`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(liveListing.id, liveListing);
      const source = listingSeoSourceFor(product, liveListing);
      const event = unwrap(
        HermesEvent.create({
          id: eventId,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type:
            proposedChange.kind === 'description' ? 'update_description' : 'suggested_better_title',
          severity: 'info',
          title: `Listing SEO suggestion: ${proposedChange.field}`,
          detail: 'Review-only suggestion from listing-seo@1.0.0.',
          proposedChange,
        })
      );
      await eventRepo.save(event);
      await eventRepo.recordAgentRecommendationOutcome({
        id: `${eventId}-recommendation`,
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: event.id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        sourceFingerprint: source,
        recommendationFingerprint: listingSeoRecommendationFingerprint(source, proposedChange.to),
        outcome: 'suggested',
        suggestedAt: new Date(),
      });

      const result = await useCase.execute({
        eventId: event.id,
        workspaceId: 'ws-1',
        actorId: 'user-1',
      });

      expect(result.isOk()).toBe(true);
      expect((await eventRepo.findById(event.id))?.status).toBe('applied');
      expect(product.name).toBe(proposedChange.kind === 'title' ? proposedChange.to : 'Lamp');
      expect(product.description).toBe(
        proposedChange.kind === 'description'
          ? proposedChange.to
          : 'A beautiful vintage brass lamp in excellent condition.'
      );
      expect(saveProduct).toHaveBeenCalledWith(product);
      expect(publishQueue.jobs).toHaveLength(1);
      expect(publishQueue.jobs[0]).toMatchObject({
        options: { jobId: 'update:rec-1' },
        data: {
          operationId: 'rec-1',
          mode: 'update',
          listingId: liveListing.id,
          marketplaceId: 'mp-1',
          changes:
            proposedChange.kind === 'title'
              ? { productName: proposedChange.to }
              : { description: proposedChange.to },
          input: expect.objectContaining({
            productName: proposedChange.kind === 'title' ? proposedChange.to : 'Lamp',
            description:
              proposedChange.kind === 'description'
                ? proposedChange.to
                : 'A beautiful vintage brass lamp in excellent condition.',
            price: 100,
            category: 'home',
            condition: 'good',
            imageUrls: [],
          }),
          productUpdatedAt: product.updatedAt.toISOString(),
          listingUpdatedAt: liveListing.updatedAt.toISOString(),
        },
      });
      expect(activityLog.entries[0].metadata.marketplaceSync).toMatchObject({
        status: 'queued',
        operations: [expect.objectContaining({ operationId: 'rec-1', listingId: liveListing.id })],
      });
      expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({
        approvedAt: expect.any(Date),
        appliedAt: expect.any(Date),
      });
    }
  );

  it.each([
    {
      kind: 'title' as const,
      from: 'Lamp',
      to: 'Better Lamp',
      eventType: 'suggested_better_title' as const,
    },
    {
      kind: 'description' as const,
      from: 'A beautiful vintage brass lamp in excellent condition.',
      to: 'A richer product description for buyers.',
      eventType: 'update_description' as const,
    },
  ])(
    'does not mark a listing-seo $kind Apply applied when queue acceptance fails',
    async (change) => {
      const { useCase, eventRepo, product, listingRepo, publishQueue } = setup();
      const liveListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-queue-fails`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-${change.kind}-queue-fails`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(liveListing.id, liveListing);
      const source = listingSeoSourceFor(product, liveListing);
      const event = unwrap(
        HermesEvent.create({
          id: `evt-listing-seo-${change.kind}-queue-fails`,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type: change.eventType,
          severity: 'info',
          title: `Listing SEO suggestion: ${change.kind}`,
          proposedChange: {
            kind: change.kind,
            field: change.kind,
            from: change.from,
            to: change.to,
          },
        })
      );
      await eventRepo.save(event);
      await eventRepo.recordAgentRecommendationOutcome({
        id: `${event.id}-recommendation`,
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: event.id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        sourceFingerprint: source,
        recommendationFingerprint: listingSeoRecommendationFingerprint(source, change.to),
        outcome: 'suggested',
        suggestedAt: new Date(),
      });
      jest.spyOn(publishQueue, 'enqueueAll').mockRejectedValueOnce(new Error('queue unavailable'));

      await expect(
        useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' })
      ).rejects.toThrow('queue unavailable');
      expect(product.name).toBe('Lamp');
      expect(product.description).toBe('A beautiful vintage brass lamp in excellent condition.');
      expect((await eventRepo.findById(event.id))?.status).toBe('failed');
      expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({ outcome: 'failed' });
      expect([...eventRepo.agentRecommendations.values()][0].appliedAt).toBeUndefined();
    }
  );

  it('safely reconciles old no-op applied listing-seo events only when source and from fences still match', async () => {
    const { useCase, eventRepo, product, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-reconcile',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-reconcile',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const source = listingSeoSourceFor(product, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-listing-seo-reconcile',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Listing SEO suggestion: title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Reconciled Lamp' },
      })
    );
    unwrap(event.approve());
    unwrap(event.markApplied());
    await eventRepo.save(event);
    await eventRepo.recordAgentRecommendationOutcome({
      id: 'evt-listing-seo-reconcile-recommendation',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      eventId: event.id,
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: source,
      recommendationFingerprint: listingSeoRecommendationFingerprint(source, 'Reconciled Lamp'),
      outcome: 'suggested',
      suggestedAt: new Date(),
      approvedAt: new Date(),
      appliedAt: new Date(),
    });

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(product.name).toBe('Reconciled Lamp');
    expect(publishQueue.jobs).toHaveLength(1);
    expect(activityLog.entries[0]).toMatchObject({ action: 'hermes_event.reconciled' });

    const staleReplay = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });
    expect(staleReplay.isErr()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(1);
  });

  it('does not require a marketplace update for live reconciliation targets missing marketplaceListingId', async () => {
    const { useCase, eventRepo, product, listingRepo, publishQueue, activityLog } = setup();
    const localOnlyLiveListing = unwrap(
      Listing.create({
        id: 'lst-live-reconcile-local-only',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(localOnlyLiveListing.id, localOnlyLiveListing);
    const source = listingSeoSourceFor(product, localOnlyLiveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-listing-seo-reconcile-local-only',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Listing SEO suggestion: title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Local-only Lamp' },
      })
    );
    unwrap(event.approve());
    unwrap(event.markApplied());
    await eventRepo.save(event);
    await eventRepo.recordAgentRecommendationOutcome({
      id: 'evt-listing-seo-reconcile-local-only-recommendation',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      eventId: event.id,
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: source,
      recommendationFingerprint: listingSeoRecommendationFingerprint(source, 'Local-only Lamp'),
      outcome: 'suggested',
      suggestedAt: new Date(),
      approvedAt: new Date(),
      appliedAt: new Date(),
    });

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(product.name).toBe('Local-only Lamp');
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries[0]).toMatchObject({
      action: 'hermes_event.reconciled',
      metadata: expect.objectContaining({ marketplaceSync: { status: 'not_required' } }),
    });
  });

  it('does not partially mutate product when listing-seo reconciliation cannot queue a live update', async () => {
    const { useCase, eventRepo, product, listingRepo, publishQueue, activityLog } =
      setup('missing');
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-reconcile-disconnected',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-reconcile-disconnected',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const source = listingSeoSourceFor(product, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-listing-seo-reconcile-disconnected',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Listing SEO suggestion: title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Unsafe Lamp' },
      })
    );
    unwrap(event.approve());
    unwrap(event.markApplied());
    await eventRepo.save(event);
    await eventRepo.recordAgentRecommendationOutcome({
      id: 'evt-listing-seo-reconcile-disconnected-recommendation',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      eventId: event.id,
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: source,
      recommendationFingerprint: listingSeoRecommendationFingerprint(source, 'Unsafe Lamp'),
      outcome: 'suggested',
      suggestedAt: new Date(),
      approvedAt: new Date(),
      appliedAt: new Date(),
    });

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isErr()).toBe(true);
    expect(product.name).toBe('Lamp');
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries).toEqual([
      expect.objectContaining({
        action: 'hermes_event.reconciliation_failed',
        metadata: expect.objectContaining({ reason: 'marketplace_account_not_connected' }),
      }),
    ]);
  });

  it.each([
    {
      kind: 'title' as const,
      current: 'Current Lamp',
      from: 'Lamp',
      to: 'Queued Lamp',
      eventType: 'suggested_better_title' as const,
    },
    {
      kind: 'description' as const,
      current: 'Current rich lamp copy for buyers.',
      from: 'A beautiful vintage brass lamp in excellent condition.',
      to: 'Queued rich lamp copy for buyers.',
      eventType: 'update_description' as const,
    },
  ])(
    'restores the actual pre-apply product $kind when proposed from is stale and live queueing fails',
    async (change) => {
      const { useCase, eventRepo, product, listingRepo } = setup('missing');
      if (change.kind === 'title') {
        unwrap(product.rename(change.current));
      } else {
        unwrap(product.updateDescription(change.current));
      }
      const liveListing = unwrap(
        Listing.create({
          id: `lst-live-stale-${change.kind}`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-stale-${change.kind}`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(liveListing.id, liveListing);
      const event = unwrap(
        HermesEvent.create({
          id: `evt-stale-${change.kind}`,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type: change.eventType,
          severity: 'info',
          title: `Listing SEO suggestion: ${change.kind}`,
          proposedChange: {
            kind: change.kind,
            field: change.kind,
            from: change.from,
            to: change.to,
          },
        })
      );
      await eventRepo.save(event);

      const result = await useCase.execute({
        eventId: event.id,
        workspaceId: 'ws-1',
        actorId: 'user-1',
      });

      expect(result.isErr()).toBe(true);
      expect(change.kind === 'title' ? product.name : product.description).toBe(change.current);
      expect(change.kind === 'title' ? product.name : product.description).not.toBe(change.from);
      expect((await eventRepo.findById(event.id))?.status).toBe('failed');
    }
  );

  it('records and propagates rollback persistence failure when listing-seo apply cannot queue', async () => {
    const { useCase, eventRepo, product, productRepo, listingRepo, activityLog } = setup('missing');
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-rollback-save-fails',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-rollback-save-fails',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-rollback-save-fails',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Listing SEO suggestion: title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Queued Lamp' },
      })
    );
    await eventRepo.save(event);
    jest
      .spyOn(productRepo, 'save')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback write failed'));

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('Listing SEO rollback save failed');
    expect(product.name).toBe('Lamp');
    expect(activityLog.entries).toEqual([
      expect.objectContaining({
        action: 'hermes_event.reconciliation_rollback_failed',
        metadata: expect.objectContaining({
          reason: 'missing_live_listing_update',
          rollbackError: 'Listing SEO rollback save failed',
        }),
      }),
    ]);
    expect((await eventRepo.findById(event.id))?.status).toBe('failed');
  });

  it('rolls back listing-seo reconciliation product changes when queue acceptance throws', async () => {
    const { useCase, eventRepo, product, listingRepo, publishQueue, activityLog } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-reconcile-queue-throws',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-reconcile-queue-throws',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const source = listingSeoSourceFor(product, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-listing-seo-reconcile-queue-throws',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Listing SEO suggestion: title',
        proposedChange: { kind: 'title', field: 'title', from: 'Lamp', to: 'Unsafe Lamp' },
      })
    );
    unwrap(event.approve());
    unwrap(event.markApplied());
    await eventRepo.save(event);
    await eventRepo.recordAgentRecommendationOutcome({
      id: 'evt-listing-seo-reconcile-queue-throws-recommendation',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      eventId: event.id,
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: source,
      recommendationFingerprint: listingSeoRecommendationFingerprint(source, 'Unsafe Lamp'),
      outcome: 'suggested',
      suggestedAt: new Date(),
      approvedAt: new Date(),
      appliedAt: new Date(),
    });
    jest.spyOn(publishQueue, 'enqueueAll').mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(
      useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' })
    ).rejects.toThrow('queue unavailable');
    expect(product.name).toBe('Lamp');
    expect(activityLog.entries).toEqual([
      expect.objectContaining({
        action: 'hermes_event.reconciliation_failed',
        metadata: expect.objectContaining({ reason: 'queue_acceptance_failed' }),
      }),
    ]);
  });

  it('keeps draft listings local-only for approved description changes', async () => {
    const { useCase, eventRepo, publishQueue, activityLog } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-description',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'listing_optimization',
        severity: 'info',
        title: 'Improve description',
        proposedChange: {
          kind: 'description',
          field: 'description',
          from: 'Old description',
          to: 'A richer product description for buyers.',
        },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries[0].metadata.marketplaceSync).toEqual({ status: 'not_required' });
  });

  it.each([
    {
      kind: 'title' as const,
      from: 'Lamp',
      to: 'Better Lamp',
      eventType: 'suggested_better_title' as const,
    },
    {
      kind: 'description' as const,
      from: 'A beautiful vintage brass lamp in excellent condition.',
      to: 'A richer product description for buyers.',
      eventType: 'update_description' as const,
    },
  ])(
    'fails without mutating the product when a live $kind target is disconnected',
    async (change) => {
      const { useCase, eventRepo, product, listingRepo, publishQueue, activityLog } =
        setup('missing');
      const liveListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-disconnected`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-${change.kind}-missing-account`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(liveListing.id, liveListing);
      const source = listingSeoSourceFor(product, liveListing);
      const event = unwrap(
        HermesEvent.create({
          id: `evt-${change.kind}-disconnected`,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type: change.eventType,
          severity: 'warning',
          title: `Improve ${change.kind}`,
          proposedChange: {
            kind: change.kind,
            field: change.kind,
            from: change.from,
            to: change.to,
          },
        })
      );
      await eventRepo.save(event);
      await eventRepo.recordAgentRecommendationOutcome({
        id: `${event.id}-recommendation`,
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: event.id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        sourceFingerprint: source,
        recommendationFingerprint: listingSeoRecommendationFingerprint(source, change.to),
        outcome: 'suggested',
        suggestedAt: new Date(),
      });

      const result = await useCase.execute({
        eventId: event.id,
        workspaceId: 'ws-1',
        actorId: 'user-1',
      });

      expect(result.isErr()).toBe(true);
      expect(product.name).toBe('Lamp');
      expect(product.description).toBe('A beautiful vintage brass lamp in excellent condition.');
      expect((await eventRepo.findById(event.id))?.status).toBe('failed');
      expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({ outcome: 'failed' });
      expect([...eventRepo.agentRecommendations.values()][0].appliedAt).toBeUndefined();
      expect(publishQueue.jobs).toHaveLength(0);
      expect(activityLog.entries).toHaveLength(0);
    }
  );

  it.each([
    {
      kind: 'title' as const,
      from: 'Lamp',
      to: 'Better Lamp',
      eventType: 'suggested_better_title' as const,
    },
    {
      kind: 'description' as const,
      from: 'A beautiful vintage brass lamp in excellent condition.',
      to: 'A richer product description for buyers.',
      eventType: 'update_description' as const,
    },
  ])(
    'fails closed before queueing when multi-target listing-seo $kind Apply includes a disconnected target',
    async (change) => {
      const { useCase, eventRepo, product, listingRepo, marketplaceRepo, publishQueue } = setup();
      const connectedListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-connected`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-${change.kind}-connected`,
          price: money(100),
          status: 'live',
        })
      );
      const disconnectedMarketplace = unwrap(
        Marketplace.create({
          id: `mp-${change.kind}-disconnected`,
          workspaceId: 'ws-1',
          key: 'ebay',
          name: 'Disconnected marketplace',
          connected: false,
        })
      );
      const disconnectedListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-disconnected-multi`,
          productId: 'prod-1',
          marketplaceId: disconnectedMarketplace.id,
          marketplaceListingId: `remote-${change.kind}-disconnected`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(connectedListing.id, connectedListing);
      listingRepo.items.set(disconnectedListing.id, disconnectedListing);
      marketplaceRepo.items.set(disconnectedMarketplace.id, disconnectedMarketplace);
      const connectedUpdatedAt = connectedListing.updatedAt;
      const disconnectedUpdatedAt = disconnectedListing.updatedAt;
      const source = listingSeoSourceFor(product, connectedListing);
      const event = unwrap(
        HermesEvent.create({
          id: `evt-${change.kind}-multi-disconnected`,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type: change.eventType,
          severity: 'warning',
          title: `Improve ${change.kind}`,
          proposedChange: {
            kind: change.kind,
            field: change.kind,
            from: change.from,
            to: change.to,
          },
        })
      );
      await eventRepo.save(event);
      await eventRepo.recordAgentRecommendationOutcome({
        id: `${event.id}-recommendation`,
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: event.id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        sourceFingerprint: source,
        recommendationFingerprint: listingSeoRecommendationFingerprint(source, change.to),
        outcome: 'suggested',
        suggestedAt: new Date(),
      });

      const result = await useCase.execute({
        eventId: event.id,
        workspaceId: 'ws-1',
        actorId: 'user-1',
      });

      expect(result.isErr()).toBe(true);
      expect(product.name).toBe('Lamp');
      expect(product.description).toBe('A beautiful vintage brass lamp in excellent condition.');
      expect((await listingRepo.findById(connectedListing.id))?.updatedAt).toBe(connectedUpdatedAt);
      expect((await listingRepo.findById(disconnectedListing.id))?.updatedAt).toBe(
        disconnectedUpdatedAt
      );
      expect((await eventRepo.findById(event.id))?.status).toBe('failed');
      expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({ outcome: 'failed' });
      expect([...eventRepo.agentRecommendations.values()][0].appliedAt).toBeUndefined();
      expect(publishQueue.jobs).toHaveLength(0);
    }
  );

  it.each([
    {
      kind: 'title' as const,
      from: 'Lamp',
      to: 'Better Lamp',
      eventType: 'suggested_better_title' as const,
    },
    {
      kind: 'description' as const,
      from: 'A beautiful vintage brass lamp in excellent condition.',
      to: 'A richer product description for buyers.',
      eventType: 'update_description' as const,
    },
  ])(
    'fails closed without partial queue acceptance when multi-target listing-seo $kind Apply batch enqueue throws',
    async (change) => {
      const { useCase, eventRepo, product, listingRepo, publishQueue } = setup();
      const firstListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-batch-1`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-${change.kind}-batch-1`,
          price: money(100),
          status: 'live',
        })
      );
      const secondListing = unwrap(
        Listing.create({
          id: `lst-live-${change.kind}-batch-2`,
          productId: 'prod-1',
          marketplaceId: 'mp-1',
          marketplaceListingId: `olx-${change.kind}-batch-2`,
          price: money(100),
          status: 'live',
        })
      );
      listingRepo.items.set(firstListing.id, firstListing);
      listingRepo.items.set(secondListing.id, secondListing);
      const firstUpdatedAt = firstListing.updatedAt;
      const secondUpdatedAt = secondListing.updatedAt;
      const source = listingSeoSourceFor(product, firstListing);
      const event = unwrap(
        HermesEvent.create({
          id: `evt-${change.kind}-multi-batch-throws`,
          workspaceId: 'ws-1',
          productId: 'prod-1',
          type: change.eventType,
          severity: 'warning',
          title: `Improve ${change.kind}`,
          proposedChange: {
            kind: change.kind,
            field: change.kind,
            from: change.from,
            to: change.to,
          },
        })
      );
      await eventRepo.save(event);
      await eventRepo.recordAgentRecommendationOutcome({
        id: `${event.id}-recommendation`,
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: event.id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        sourceFingerprint: source,
        recommendationFingerprint: listingSeoRecommendationFingerprint(source, change.to),
        outcome: 'suggested',
        suggestedAt: new Date(),
      });
      const enqueueAll = jest
        .spyOn(publishQueue, 'enqueueAll')
        .mockRejectedValueOnce(new Error('second queue item rejected'));

      await expect(
        useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' })
      ).rejects.toThrow('second queue item rejected');
      expect(enqueueAll).toHaveBeenCalledWith([
        expect.objectContaining({ data: expect.objectContaining({ listingId: firstListing.id }) }),
        expect.objectContaining({ data: expect.objectContaining({ listingId: secondListing.id }) }),
      ]);
      expect(product.name).toBe('Lamp');
      expect(product.description).toBe('A beautiful vintage brass lamp in excellent condition.');
      expect((await listingRepo.findById(firstListing.id))?.updatedAt).toBe(firstUpdatedAt);
      expect((await listingRepo.findById(secondListing.id))?.updatedAt).toBe(secondUpdatedAt);
      expect((await eventRepo.findById(event.id))?.status).toBe('failed');
      expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({ outcome: 'failed' });
      expect([...eventRepo.agentRecommendations.values()][0].appliedAt).toBeUndefined();
      expect(publishQueue.jobs).toHaveLength(0);
    }
  );

  it('updates listing price locally and queues remote price update for live listings', async () => {
    const { useCase, eventRepo, listingRepo, publishQueue } = setup();
    const liveListing = unwrap(
      Listing.create({
        id: 'lst-live-price',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        marketplaceListingId: 'olx-456',
        price: money(100),
        status: 'live',
      })
    );
    listingRepo.items.set(liveListing.id, liveListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-price',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect((await listingRepo.findById('lst-live-price'))?.price.amount).toBe(90);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data).toMatchObject({
      mode: 'update',
      listingId: 'lst-live-price',
      changes: { price: 90 },
      input: expect.objectContaining({ price: 90 }),
    });
  });

  it('refuses silent combined category correction and leaves both intents pending without queueing', async () => {
    const { useCase, eventRepo, publishQueue, activityLog } = setup();
    const category = {
      providerCategoryId: 'projectors',
      name: 'Projectors',
      path: ['Electronics', 'Projectors'],
      source: 'provider_taxonomy' as const,
      confidence: 0.98,
      isLeaf: true,
      taxonomyVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
      taxonomyStaleAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
    };
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-category',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'olx_category_mismatch',
        severity: 'critical',
        title: 'Category mismatch',
        proposedChange: {
          kind: 'category_recreation',
          listingId: 'lst-1',
          currentCategory: {
            ...category,
            providerCategoryId: 'headphones',
            name: 'Headphones',
            path: ['Electronics', 'Headphones'],
          },
          proposedCategory: category,
          operations: [
            {
              kind: 'delist',
              intentId: 'delist-1',
              status: 'pending_review',
              providerSideEffectAllowed: false,
              quotaUnitsRestored: 0,
            },
            {
              kind: 'recreate',
              intentId: 'recreate-1',
              status: 'blocked_pending_quota_review',
              providerSideEffectAllowed: false,
              quotaGuardRequired: true,
            },
          ],
        },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isErr()).toBe(true);
    expect((await eventRepo.findById(event.id))?.status).toBe('pending_review');
    expect(publishQueue.jobs).toHaveLength(0);
    expect(activityLog.entries).toEqual([
      expect.objectContaining({ action: 'olx.category_recreation_combined_approval_refused' }),
    ]);
  });

  it('rejects approving an event that is not pending_review', async () => {
    const { useCase, eventRepo } = setup();

    const event = unwrap(
      HermesEvent.create({
        id: 'evt-2',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    unwrap(event.approve());
    unwrap(event.markApplied()); // move to applied
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: 'evt-2', workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_STATE');
  });

  it('rejects applying informational recommendations without a proposed change', async () => {
    const { useCase, eventRepo, publishQueue } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-photos',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_more_photos',
        severity: 'info',
        title: 'Add photos',
        detail: 'Acknowledgement-only legacy recommendation.',
        proposedChange: null,
      })
    );
    await eventRepo.save(event);
    await eventRepo.recordAgentRecommendationOutcome({
      id: 'rec-photos',
      workspaceId: 'ws-1',
      productId: 'prod-1',
      eventId: event.id,
      agentId: 'listing-seo',
      agentVersion: '1.0.0',
      creativityPreset: 'balanced',
      sourceFingerprint: '0'.repeat(64),
      recommendationFingerprint: '1'.repeat(64),
      outcome: 'suggested',
      suggestedAt: new Date(),
    });

    const result = await useCase.execute({
      eventId: event.id,
      workspaceId: 'ws-1',
      actorId: 'user-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_STATE');
    expect((await eventRepo.findById(event.id))?.status).toBe('failed');
    expect(publishQueue.jobs).toHaveLength(0);
    expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({ outcome: 'failed' });
  });

  it('returns NOT_FOUND for an unknown event', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ eventId: 'nope', workspaceId: 'ws-1' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('persists failed when an application dependency throws', async () => {
    const { useCase, eventRepo, productRepo } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-thrown',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);
    jest.spyOn(productRepo, 'save').mockRejectedValueOnce(new Error('database unavailable'));

    await expect(useCase.execute({ eventId: event.id, workspaceId: 'ws-1' })).rejects.toThrow(
      'database unavailable'
    );
    expect((await eventRepo.findById(event.id))?.status).toBe('failed');
  });

  it('persists failed when approval provenance timestamping throws before applying', async () => {
    const { useCase, eventRepo, product } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-approval-provenance',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);
    jest
      .spyOn(eventRepo, 'markAgentRecommendationApproved')
      .mockRejectedValueOnce(new Error('provenance write failed'));

    await expect(
      useCase.execute({ eventId: event.id, workspaceId: 'ws-1', actorId: 'user-1' })
    ).rejects.toThrow('provenance write failed');
    expect((await eventRepo.findById(event.id))?.status).toBe('failed');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('does not enqueue a relist when the OAuth account is disconnected', async () => {
    const { useCase, eventRepo, publishQueue } = setup('missing');
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-relist',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Relist product',
        proposedChange: { kind: 'relist', listingIds: ['lst-1'] },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('INVALID_STATE');
    expect(publishQueue.jobs).toHaveLength(0);
    expect((await eventRepo.findById(event.id))?.status).toBe('failed');
  });

  it('returns a structured guard error when the OLX quota guard is unavailable', async () => {
    const { useCase, eventRepo, publishQueue } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-relist-no-guard',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Relist product',
        proposedChange: { kind: 'relist', listingIds: ['lst-1'] },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(GuardrailViolationError);
      expect(result.error.details).toEqual({
        quotaDecision: {
          applicable: true,
          marketplaceKey: 'olx',
          status: 'unknown',
          decision: 'block',
          reason: 'quota_guard_unavailable',
          requiresOverride: true,
        },
      });
    }
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('does not retry already-authorized relists when a later quota decision blocks', async () => {
    const authorize = jest
      .fn()
      .mockResolvedValueOnce({ decision: 'allow' })
      .mockResolvedValueOnce({ decision: 'block' });
    const quotaService = {
      authorize,
      guardError: () => new GuardrailViolationError('quota blocked'),
    } as unknown as OlxPublicationQuotaService;
    const { useCase, eventRepo, listingRepo, publishQueue } = setup('connected', quotaService);
    const secondListing = unwrap(
      Listing.create({
        id: 'lst-2',
        productId: 'prod-1',
        marketplaceId: 'mp-1',
        price: money(100),
      })
    );
    listingRepo.items.set(secondListing.id, secondListing);
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-relist-preflight',
        workspaceId: 'ws-1',
        productId: 'prod-1',
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Relist product',
        proposedChange: { kind: 'relist', listingIds: ['lst-1', 'lst-2'] },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: event.id, workspaceId: 'ws-1' });

    expect(result.isOk()).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data.listingId).toBe('lst-1');
    expect((await eventRepo.findById(event.id))?.status).toBe('applied');
  });

  it('returns NOT_FOUND when approving an event from another workspace (IDOR, S2)', async () => {
    const { useCase, eventRepo, product } = setup();
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-x',
        workspaceId: 'ws-1',
        productId: product.id,
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower the price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 90 },
      })
    );
    await eventRepo.save(event);

    const result = await useCase.execute({ eventId: 'evt-x', workspaceId: 'ws-other' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
    // The event must remain untouched (still pending_review) for its real owner.
    const reloaded = await eventRepo.findById('evt-x');
    expect(reloaded!.status).toBe('pending_review');
  });
});
