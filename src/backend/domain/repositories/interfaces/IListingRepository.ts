import type { Listing } from '../../entities/Listing';

export interface IListingRepository {
  findById(id: string): Promise<Listing | null>;
  // Tenant-scoped read (listing -> product -> workspace). Null on mismatch (S2).
  findByIdForWorkspace(id: string, workspaceId: string): Promise<Listing | null>;
  findByProduct(productId: string): Promise<Listing[]>;
  findByMarketplace(marketplaceId: string): Promise<Listing[]>;
  findByWorkspace(workspaceId: string): Promise<Listing[]>;
  // Listings that are live and expire before the given cutoff.
  findExpiring(before: Date): Promise<Listing[]>;
  save(listing: Listing): Promise<void>;
  saveAfterConfirmedDelist(listing: Listing, expectedExternalListingId: string): Promise<void>;
  saveAll(listings: Listing[]): Promise<void>;
  delete(id: string): Promise<void>;
}
