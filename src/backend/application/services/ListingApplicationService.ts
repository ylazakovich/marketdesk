// Application service (facade) for listing workflows: publish + marketplace sync
// use cases, plus paginated read methods for controllers.

import { Result, Ok } from '../../domain/shared/Result';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { PaginatedResponse } from '../../../shared/types';
import { PublishListingUseCase } from '../usecases/PublishListingUseCase';
import {
  SyncMarketplaceUseCase,
  type SyncMarketplaceEnqueueResult,
} from '../usecases/SyncMarketplaceUseCase';
import type { PublishListingDTO } from '../dto/PublishListingDTO';
import type { SyncMarketplaceDTO } from '../dto/HermesDTO';
import { presentListing, type ListingView } from '../dto/presenters';
import { normalizeLimit, normalizeOffset, paginate } from '../dto/pagination';

export class ListingApplicationService {
  constructor(
    private readonly listingRepo: IListingRepository,
    private readonly publishListingUseCase: PublishListingUseCase,
    private readonly syncMarketplaceUseCase: SyncMarketplaceUseCase
  ) {}

  async publishListing(dto: PublishListingDTO): Promise<Result<ListingView>> {
    const result = await this.publishListingUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentListing(result.value));
  }

  // Relisting is "publish again": it runs the same PublishListingUseCase so the
  // non-sold-product / connected-marketplace / price-set invariants are enforced
  // and a real republish job is enqueued, instead of only flipping the DB status
  // (C6). Callers must scope the listing to the tenant before invoking this.
  async relistListing(dto: PublishListingDTO): Promise<Result<ListingView>> {
    const result = await this.publishListingUseCase.execute({ ...dto, mode: 'relist' });
    return result.isErr() ? result : Ok(presentListing(result.value));
  }

  async syncMarketplace(dto: SyncMarketplaceDTO): Promise<Result<SyncMarketplaceEnqueueResult>> {
    return this.syncMarketplaceUseCase.execute(dto);
  }

  async getListing(id: string, workspaceId: string): Promise<ListingView | null> {
    // Tenant-scoped (listing -> product -> workspace) so a cross-workspace id
    // reads as not-found (S2).
    const listing = await this.listingRepo.findByIdForWorkspace(id, workspaceId);
    return listing ? presentListing(listing) : null;
  }

  async listByProduct(productId: string): Promise<ListingView[]> {
    const listings = await this.listingRepo.findByProduct(productId);
    return listings.map(presentListing);
  }

  async listByWorkspace(
    workspaceId: string,
    limit?: number,
    offset?: number
  ): Promise<PaginatedResponse<ListingView>> {
    const listings = await this.listingRepo.findByWorkspace(workspaceId);
    const sorted = [...listings].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return paginate(sorted, normalizeOffset(offset), normalizeLimit(limit), presentListing);
  }
}
