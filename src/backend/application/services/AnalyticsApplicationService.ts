// Application service (facade) for analytics/dashboard reads. No analytics event
// store is wired at this layer, so metrics are derived from the current product and
// listing aggregates (counts, status breakdowns, engagement totals). Historical
// time-series aggregation (ARCHITECTURE.md §16) is a separate infrastructure concern.

import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
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
    const listings = await this.listingRepo.findByWorkspace(workspaceId);
    return listings
      .map((l) => ({
        listingId: l.id,
        productId: l.productId,
        status: l.status,
        price: l.price.amount,
        views: l.views,
        watchers: l.watchers,
        messages: l.messages,
      }))
      .sort((a, b) => b.views - a.views);
  }
}
