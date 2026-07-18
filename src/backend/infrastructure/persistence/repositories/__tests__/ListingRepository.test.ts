import type { PoolClient } from 'pg';
import { query as mockedQuery } from '../../../../config/database';
import { ListingRepository } from '../ListingRepository';
import { Listing } from '../../../../domain/entities/Listing';
import { money, unwrap } from '../../../../domain/testkit/support';

jest.mock('../../../../config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

function liveListing() {
  return unwrap(Listing.create({
    id: 'listing-1',
    productId: 'product-1',
    marketplaceId: 'marketplace-1',
    price: money(299),
    status: 'live',
    marketplaceListingId: 'old-advert-1',
  }));
}

describe('ListingRepository confirmed delist persistence', () => {
  beforeEach(() => {
    (mockedQuery as jest.Mock).mockReset();
  });

  it('conditionally clears only the captured live remote identity', async () => {
    const client = { query: jest.fn() } as unknown as PoolClient;
    const repository = new ListingRepository(undefined, client);
    const listing = liveListing();
    const transitioned = listing.returnToDraftAfterDelist('old-advert-1');
    if (transitioned.isErr()) throw transitioned.error;
    (mockedQuery as jest.Mock).mockResolvedValueOnce({ rows: [{ id: listing.id }], rowCount: 1 });

    await repository.saveAfterConfirmedDelist(listing, 'old-advert-1');

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND marketplace_listing_id = $11 AND status = 'live'"),
      expect.arrayContaining(['listing-1', 'old-advert-1']),
      client,
    );
  });

  it('fails closed when another writer replaced the remote identity', async () => {
    const client = { query: jest.fn() } as unknown as PoolClient;
    const repository = new ListingRepository(undefined, client);
    const listing = liveListing();
    const transitioned = listing.returnToDraftAfterDelist('old-advert-1');
    if (transitioned.isErr()) throw transitioned.error;
    (mockedQuery as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      repository.saveAfterConfirmedDelist(listing, 'old-advert-1'),
    ).rejects.toThrow('Listing remote identity changed concurrently; reconcile delist');
  });
});
