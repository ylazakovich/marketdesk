import { PublishListingUseCase } from '../usecases/PublishListingUseCase';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  unwrap,
  money,
} from '../../domain/testkit/support';
import { InMemoryActivityLogRepository, RecordingJobQueue, idFactory } from '../testkit/support';
import type { PublishListingJob } from '../ports/IJobQueue';
import type { MarketplaceAccountRepository } from '../services/MarketplaceOAuthService';

function setup(connected: boolean, oauthAccount: 'connected' | 'missing' | 'legacy' = 'legacy') {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const publishQueue = new RecordingJobQueue<PublishListingJob>();
  const accountRepo: MarketplaceAccountRepository | undefined =
    oauthAccount === 'legacy'
      ? undefined
      : {
          findByMarketplaceId: async () =>
            oauthAccount === 'connected'
              ? {
                  id: 'account-1',
                  marketplaceId: 'mp-1',
                  handle: 'OLX account',
                  credentials: {},
                  status: 'connected',
                  scopes: ['basic'],
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

  const product = unwrap(
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
      images: ['a.jpg'],
    })
  );
  const marketplace = unwrap(
    Marketplace.create({ id: 'mp-1', workspaceId: 'ws-1', key: 'olx', name: 'OLX', connected })
  );
  const listing = unwrap(
    Listing.create({
      id: 'lst-1',
      productId: 'prod-1',
      marketplaceId: 'mp-1',
      price: money(100),
    })
  );
  productRepo.items.set(product.id, product);
  marketplaceRepo.items.set(marketplace.id, marketplace);
  listingRepo.items.set(listing.id, listing);

  const useCase = new PublishListingUseCase(
    listingRepo,
    productRepo,
    marketplaceRepo,
    publishQueue,
    activityLog,
    idFactory('rec'),
    accountRepo
  );
  return { useCase, publishQueue, activityLog };
}

describe('PublishListingUseCase', () => {
  it('rejects publishing when the marketplace is not connected', async () => {
    const { useCase, publishQueue } = setup(false);

    const result = await useCase.execute({ listingId: 'lst-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('GUARDRAIL_VIOLATION');
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('enqueues a publish job and logs intent when connected', async () => {
    const { useCase, publishQueue, activityLog } = setup(true);

    const result = await useCase.execute({ listingId: 'lst-1', actorId: 'user-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data).toMatchObject({
      operationId: 'rec-1',
      marketplaceKey: 'olx',
      marketplaceId: 'mp-1',
      listingId: 'lst-1',
    });
    expect(publishQueue.jobs[0].options).toEqual({ jobId: 'publish:rec-1' });
    expect(publishQueue.jobs[0].data.input.price).toBe(100);
    expect(activityLog.entries.map((e) => e.action)).toContain('listing.publish_requested');
  });

  it('enqueues with marketplaceId when the OAuth account is connected', async () => {
    const { useCase, publishQueue } = setup(true, 'connected');

    const result = await useCase.execute({ listingId: 'lst-1' });

    expect(result.isOk()).toBe(true);
    expect(publishQueue.jobs).toHaveLength(1);
    expect(publishQueue.jobs[0].data).toMatchObject({
      marketplaceKey: 'olx',
      marketplaceId: 'mp-1',
      listingId: 'lst-1',
    });
  });

  it('rejects publishing when the local flag is true but no OAuth account exists', async () => {
    const { useCase, publishQueue } = setup(true, 'missing');

    const result = await useCase.execute({ listingId: 'lst-1' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('GUARDRAIL_VIOLATION');
    expect(publishQueue.jobs).toHaveLength(0);
  });

  it('returns NOT_FOUND for an unknown listing', async () => {
    const { useCase } = setup(true);
    const result = await useCase.execute({ listingId: 'missing' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
  });
});
