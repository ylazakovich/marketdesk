import { Listing } from '../../../domain/entities/Listing';
import { Money } from '../../../domain/valueObjects/Money';
import type { ListingStatus } from '../../../../shared/types';
import type { ListingRow } from './rows';
import { toDate, toNullableDate, toNumber, unwrapPersisted } from './support';

export const ListingMapper = {
  toDomain(row: ListingRow): Listing {
    const price = unwrapPersisted(Money.of(toNumber(row.price), row.currency));

    return Listing.reconstitute({
      id: row.id,
      productId: row.product_id,
      marketplaceId: row.marketplace_id,
      price,
      marketplaceListingId: row.marketplace_listing_id,
      externalUrl: row.external_url,
      status: row.status as ListingStatus,
      remoteStatus: row.remote_status,
      views: row.views,
      watchers: row.watchers,
      messages: row.messages,
      publishedAt: toNullableDate(row.published_at),
      expiresAt: toNullableDate(row.expires_at),
      syncError: row.sync_error,
      lastSyncAt: toNullableDate(row.last_sync_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    });
  },
};
