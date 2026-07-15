// Application service (facade) for listing workflows: publish + marketplace sync
// use cases, plus paginated read methods for controllers.

import { Result, Ok } from '../../domain/shared/Result';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
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
    private readonly syncMarketplaceUseCase: SyncMarketplaceUseCase,
    private readonly productRepo?: IProductRepository,
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

  async listByProduct(productId: string, workspaceId?: string): Promise<ListingView[]> {
    const listings = await this.listingRepo.findByProduct(productId);
    const product =
      this.productRepo && workspaceId
        ? await this.productRepo.findByIdForWorkspace(productId, workspaceId)
        : null;
    return listings.map((listing) =>
      presentListing(listing, {
        productName: product?.name,
        productSku: product?.sku,
      }),
    );
  }

  async listByWorkspace(
    workspaceId: string,
    limit?: number,
    offset?: number
  ): Promise<PaginatedResponse<ListingView>> {
    const listings = await this.listingRepo.findByWorkspace(workspaceId);
    const sorted = [...listings].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const normalizedOffset = normalizeOffset(offset);
    const normalizedLimit = normalizeLimit(limit);
    const pageListings = sorted.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    const productIds = [...new Set(pageListings.map((listing) => listing.productId))];
    const products = this.productRepo
      ? await Promise.all(
          productIds.map((productId) => this.productRepo!.findByIdForWorkspace(productId, workspaceId)),
        )
      : [];
    const productById = new Map(
      products
        .filter((product): product is NonNullable<(typeof products)[number]> => Boolean(product))
        .map((product) => [product.id, product]),
    );
    return paginate(sorted, normalizedOffset, normalizedLimit, (listing) => {
      const product = productById.get(listing.productId);
      return presentListing(listing, {
        productName: product?.name,
        productSku: product?.sku,
      });
    });
  }
}
