// Application service (facade) for analytics/dashboard reads. No analytics event
// store is wired at this layer, so metrics are derived from the current product and
// listing aggregates (counts, status breakdowns, engagement totals). Historical
// time-series aggregation (ARCHITECTURE.md §16) is a separate infrastructure concern.

import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { ProductStatus, ListingStatus } from '../../../shared/types';

export interface DashboardMetrics {
  workspaceId: string;
  productCount: number;
  productsByStatus: Record<ProductStatus, number>;
  listingCount: number;
  listingsByStatus: Record<ListingStatus, number>;
  liveListingCount: number;
  totalViews: number;
  totalWatchers: number;
  totalMessages: number;
  inventoryValue: number;
}

export interface ListingPerformance {
  listingId: string;
  productId: string;
  productName: string | null;
  productSku: string | null;
  marketplaceId: string;
  marketplaceName: string | null;
  marketplaceListingId: string | null;
  status: ListingStatus;
  price: number;
  views: number;
  watchers: number;
  messages: number;
}

export class AnalyticsApplicationService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
  ) {}

  async getDashboardMetrics(workspaceId: string): Promise<DashboardMetrics> {
    const products = await this.productRepo.findByWorkspace(workspaceId);
    const listings = await this.listingRepo.findByWorkspace(workspaceId);

    const productsByStatus: Record<ProductStatus, number> = {
      draft: 0,
      active: 0,
      attention: 0,
      sold: 0,
    };
    let inventoryValue = 0;
    for (const p of products) {
      productsByStatus[p.status] += 1;
      if (p.status !== 'sold') inventoryValue += p.sellingPrice.amount;
    }

    const listingsByStatus: Record<ListingStatus, number> = {
      live: 0,
      draft: 0,
      expired: 0,
      error: 0,
    };
    let totalViews = 0;
    let totalWatchers = 0;
    let totalMessages = 0;
    for (const l of listings) {
      listingsByStatus[l.status] += 1;
      totalViews += l.views;
      totalWatchers += l.watchers;
      totalMessages += l.messages;
    }

    return {
      workspaceId,
      productCount: products.length,
      productsByStatus,
      listingCount: listings.length,
      listingsByStatus,
      liveListingCount: listingsByStatus.live,
      totalViews,
      totalWatchers,
      totalMessages,
      inventoryValue,
    };
  }

  async getListingPerformance(workspaceId: string): Promise<ListingPerformance[]> {
    const [listings, products, marketplaces] = await Promise.all([
      this.listingRepo.findByWorkspace(workspaceId),
      this.productRepo.findByWorkspace(workspaceId),
      this.marketplaceRepo.findByWorkspace(workspaceId),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const marketplaceById = new Map(marketplaces.map((marketplace) => [marketplace.id, marketplace]));
    return listings
      .map((listing) => {
        const product = productById.get(listing.productId);
        const marketplace = marketplaceById.get(listing.marketplaceId);
        return {
          listingId: listing.id,
          productId: listing.productId,
          productName: product?.name ?? null,
          productSku: product?.sku ?? null,
          marketplaceId: listing.marketplaceId,
          marketplaceName: marketplace?.name ?? null,
          marketplaceListingId: listing.marketplaceListingId,
          status: listing.status,
          price: listing.price.amount,
          views: listing.views,
          watchers: listing.watchers,
          messages: listing.messages,
        };
      })
      .sort((a, b) => b.views - a.views);
  }
}
