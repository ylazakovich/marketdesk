import { Marketplace } from '../../../domain/entities/Marketplace';
import type { MarketplaceKey, SyncMode } from '../../../../shared/types';
import type { MarketplaceRow } from './rows';
import { toDate, toNullableDate, unwrapPersisted } from './support';

export const MarketplaceMapper = {
  toDomain(row: MarketplaceRow): Marketplace {
    return unwrapPersisted(
      Marketplace.create({
        id: row.id,
        workspaceId: row.workspace_id,
        key: row.key as MarketplaceKey,
        name: row.name,
        connected: row.connected,
        syncMode: row.sync_mode as SyncMode,
        lastSyncAt: toNullableDate(row.last_sync_at),
        errorCount: row.error_count,
        capacity: row.capacity,
        createdAt: toDate(row.created_at),
      }),
    );
  },
};
