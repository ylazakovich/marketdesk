import { SyncMarketplaceUseCase } from '../usecases/SyncMarketplaceUseCase';
import type { SyncMarketplaceJob } from '../ports/IJobQueue';
import { RecordingJobQueue } from '../testkit/support';
import {
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Listing } from '../../domain/entities/Listing';
import { Marketplace } from '../../domain/entities/Marketplace';

function liveListing(id: string, marketplaceId: string, externalId: string) {
  return unwrap(
    Listing.create({
      id,
      productId: `product-${id}`,
      marketplaceId,
      price: money(100),
      status: 'live',
      marketplaceListingId: externalId,
      publishedAt: new Date('2026-07-14T00:00:00.000Z'),
    })
  );
}

describe('SyncMarketplaceUseCase', () => {
  it('enqueues token-free sync jobs scoped to the requested workspace', async () => {
    const marketplaces = new InMemoryMarketplaceRepository();
    const listings = new InMemoryListingRepository();
    const queue = new RecordingJobQueue<SyncMarketplaceJob>();
    const useCase = new SyncMarketplaceUseCase(marketplaces, listings, queue);
    const marketplace = unwrap(
      Marketplace.create({ id: 'marketplace-1', workspaceId: 'workspace-1', key: 'olx', name: 'OLX' })
    );
    await marketplaces.save(marketplace);
    await listings.save(liveListing('listing-1', marketplace.id, 'olx-1'));
    await listings.save(liveListing('listing-2', marketplace.id, 'olx-2'));

    const result = await useCase.execute({
      marketplaceId: marketplace.id,
      workspaceId: 'workspace-1',
      actorId: 'user-1',
    });

    expect(result.isOk()).toBe(true);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].data).toEqual({
      marketplaceKey: 'olx',
      marketplaceId: marketplace.id,
      externalListingIds: ['olx-1', 'olx-2'],
    });
    expect(JSON.stringify(queue.jobs[0].data)).not.toMatch(/access|refresh|token|bearer/i);
  });

  it('rejects marketplaces outside the requested workspace before enqueueing', async () => {
    const marketplaces = new InMemoryMarketplaceRepository();
    const listings = new InMemoryListingRepository();
    const queue = new RecordingJobQueue<SyncMarketplaceJob>();
    const useCase = new SyncMarketplaceUseCase(marketplaces, listings, queue);
    const marketplace = unwrap(
      Marketplace.create({ id: 'marketplace-2', workspaceId: 'workspace-2', key: 'olx', name: 'OLX' })
    );
    await marketplaces.save(marketplace);

    const result = await useCase.execute({
      marketplaceId: marketplace.id,
      workspaceId: 'workspace-1',
      actorId: 'user-1',
    });

    expect(result.isErr()).toBe(true);
    expect(queue.jobs).toHaveLength(0);
  });
});
