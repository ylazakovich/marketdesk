import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IAnalyticsEventRepository, AnalyticsEventRecord } from '../ports/IAnalyticsEventRepository';
import type { ProductStatus, ListingStatus } from '../../../shared/types';

function counter(value: number | null): number { return value ?? 0; }

export interface AnalyticsRange {
  from: Date;
  to: Date;
  marketplaceId?: string;
  interval?: 'day' | 'week' | 'month';
}

export interface PeriodMetrics {
  revenue: number | null;
  profit: number | null;
  totalViews: number;
  sales: number;
  conversion: number;
}

export interface DashboardMetrics extends PeriodMetrics {
  workspaceId: string;
  productCount: number;
  productsByStatus: Record<ProductStatus, number>;
  listingCount: number;
  listingsByStatus: Record<ListingStatus, number>;
  liveListingCount: number;
  totalWatchers: number;
  totalMessages: number;
  inventoryValue: number;
  previous: PeriodMetrics | null;
}

export interface RevenuePoint {
  date: string;
  revenue: number | null;
  profit: number | null;
  previous: number | null;
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
  revenue: number | null;
  profit: number | null;
  sales: number;
  views: number;
  conversion: number;
  watchers: number;
  messages: number;
}

function aggregate(events: AnalyticsEventRecord[]): PeriodMetrics {
  let revenue = 0;
  let cost = 0;
  let revenueComplete = true;
  let costComplete = true;
  let totalViews = 0;
  let sales = 0;
  for (const event of events) {
    if (event.eventType === 'view') totalViews += event.quantity;
    if (event.eventType === 'sale') {
      sales += event.quantity;
      if (event.amount === null) revenueComplete = false;
      else revenue += event.amount;
      if (event.costAtSale === null) costComplete = false;
      else cost += event.costAtSale * event.quantity;
    }
  }
  return {
    revenue: revenueComplete ? revenue : null,
    profit: revenueComplete && costComplete ? revenue - cost : null,
    totalViews,
    sales,
    conversion: totalViews > 0 ? (sales / totalViews) * 100 : 0,
  };
}

function bucketStart(date: Date, interval: 'day' | 'week' | 'month'): string {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (interval === 'week') {
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
  } else if (interval === 'month') {
    value.setUTCDate(1);
  }
  return value.toISOString();
}

export class AnalyticsApplicationService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly analyticsEvents?: IAnalyticsEventRepository,
  ) {}

  private async periodEvents(workspaceId: string, range: AnalyticsRange): Promise<AnalyticsEventRecord[]> {
    if (!this.analyticsEvents) return [];
    return this.analyticsEvents.findByRange({
      workspaceId, from: range.from, to: range.to, marketplaceId: range.marketplaceId,
    });
  }

  async getDashboardMetrics(workspaceId: string, range?: AnalyticsRange): Promise<DashboardMetrics> {
    const [products, allListings] = await Promise.all([
      this.productRepo.findByWorkspace(workspaceId), this.listingRepo.findByWorkspace(workspaceId),
    ]);
    const listings = range?.marketplaceId
      ? allListings.filter((listing) => listing.marketplaceId === range.marketplaceId)
      : allListings;
    const productsByStatus: Record<ProductStatus, number> = { draft: 0, active: 0, attention: 0, sold: 0 };
    let inventoryValue = 0;
    for (const product of products) {
      productsByStatus[product.status] += 1;
      if (product.status !== 'sold') inventoryValue += product.sellingPrice.amount;
    }
    const listingsByStatus: Record<ListingStatus, number> = { live: 0, draft: 0, expired: 0, error: 0 };
    let totalWatchers = 0;
    let currentMessages = 0;
    for (const listing of listings) {
      listingsByStatus[listing.status] += 1;
      totalWatchers += counter(listing.watchers);
      currentMessages += counter(listing.messages);
    }

    const currentEvents = range ? await this.periodEvents(workspaceId, range) : [];
    const current = range ? aggregate(currentEvents) : {
      revenue: 0, profit: 0,
      totalViews: listings.reduce((sum, listing) => sum + counter(listing.views), 0),
      sales: 0, conversion: 0,
    };
    let previous: PeriodMetrics | null = null;
    if (range && this.analyticsEvents) {
      const duration = range.to.getTime() - range.from.getTime();
      const previousEvents = await this.periodEvents(workspaceId, {
        ...range,
        from: new Date(range.from.getTime() - duration),
        to: range.from,
      });
      previous = aggregate(previousEvents);
    }
    const eventMessages = range
      ? currentEvents.filter((event) => event.eventType === 'message').reduce((sum, event) => sum + event.quantity, 0)
      : currentMessages;

    return {
      workspaceId, productCount: products.length, productsByStatus,
      listingCount: listings.length, listingsByStatus, liveListingCount: listingsByStatus.live,
      totalWatchers, totalMessages: eventMessages, inventoryValue, ...current, previous,
    };
  }

  async getRevenue(workspaceId: string, range: AnalyticsRange): Promise<{ series: RevenuePoint[]; currency: string | null }> {
    const interval = range.interval ?? 'day';
    const [current, previous] = await Promise.all([
      this.periodEvents(workspaceId, range),
      this.periodEvents(workspaceId, {
        ...range,
        from: new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime())),
        to: range.from,
      }),
    ]);
    const byBucket = new Map<string, PeriodMetrics>();
    for (const event of current) {
      const key = bucketStart(event.occurredAt, interval);
      const bucketEvents = current.filter((candidate) => bucketStart(candidate.occurredAt, interval) === key);
      byBucket.set(key, aggregate(bucketEvents));
    }
    const previousRevenue = aggregate(previous).revenue;
    const series = [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics], index) => ({
      date, revenue: metrics.revenue, profit: metrics.profit,
      previous: index === 0 ? previousRevenue : null,
    }));
    return { series, currency: current.some((event) => event.eventType === 'sale' && event.amount !== null) ? 'PLN' : null };
  }

  async getListingPerformance(workspaceId: string, range?: AnalyticsRange): Promise<ListingPerformance[]> {
    const [allListings, products, marketplaces, events] = await Promise.all([
      this.listingRepo.findByWorkspace(workspaceId), this.productRepo.findByWorkspace(workspaceId),
      this.marketplaceRepo.findByWorkspace(workspaceId), range ? this.periodEvents(workspaceId, range) : Promise.resolve([]),
    ]);
    const listings = range?.marketplaceId
      ? allListings.filter((listing) => listing.marketplaceId === range.marketplaceId)
      : allListings;
    const productById = new Map(products.map((product) => [product.id, product]));
    const marketplaceById = new Map(marketplaces.map((marketplace) => [marketplace.id, marketplace]));
    const eventByListing = new Map<string, AnalyticsEventRecord[]>();
    for (const event of events) {
      if (!event.listingId) continue;
      eventByListing.set(event.listingId, [...(eventByListing.get(event.listingId) ?? []), event]);
    }
    return listings.map((listing) => {
      const product = productById.get(listing.productId);
      const marketplace = marketplaceById.get(listing.marketplaceId);
      const metrics = range ? aggregate(eventByListing.get(listing.id) ?? []) : null;
      const views = metrics?.totalViews ?? counter(listing.views);
      const messages = range
        ? (eventByListing.get(listing.id) ?? []).filter((event) => event.eventType === 'message').reduce((sum, event) => sum + event.quantity, 0)
        : counter(listing.messages);
      return {
        listingId: listing.id, productId: listing.productId, productName: product?.name ?? null,
        productSku: product?.sku ?? null, marketplaceId: listing.marketplaceId,
        marketplaceName: marketplace?.name ?? null, marketplaceListingId: listing.marketplaceListingId,
        status: listing.status, price: listing.price.amount,
        revenue: metrics ? metrics.revenue : 0,
        profit: metrics ? metrics.profit : 0,
        sales: metrics?.sales ?? 0, views,
        conversion: metrics?.conversion ?? 0, watchers: counter(listing.watchers), messages,
      };
    }).sort((a, b) => (b.revenue ?? Number.NEGATIVE_INFINITY) - (a.revenue ?? Number.NEGATIVE_INFINITY) || b.views - a.views);
  }
}
