// Frontend-facing request/response DTOs for the API layer.
// Entity shapes live in @shared/types; this module only declares the request
// filter params and mutation inputs, plus analytics response shapes that have no
// shared-type equivalent yet (see ARCHITECTURE §6 / §18).
import type {
  Product,
  Marketplace,
  HermesEvent,
  ProductStatus,
  ListingStatus,
  HermesEventStatus,
  HermesSeverity,
  SyncMode,
} from '@shared/types';

// ----------------------------------------------------------------------------
// Products
// ----------------------------------------------------------------------------

export interface ProductListParams {
  workspaceId?: string;
  status?: ProductStatus[];
  priceMin?: number;
  priceMax?: number;
  tags?: string[];
  sort?: string; // e.g. "-updatedAt,+name"
  limit?: number;
  offset?: number;
}

export type CreateProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

export type UpdateProductInput = Partial<
  Omit<Product, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>
>;

export interface UpdateProductArg {
  id: string;
  patch: UpdateProductInput;
}

// ----------------------------------------------------------------------------
// Listings
// ----------------------------------------------------------------------------

export interface ListingListParams {
  workspaceId?: string;
  marketplaceId?: string;
  productId?: string;
  status?: ListingStatus[];
  sort?: string;
  limit?: number;
  offset?: number;
}

// Canonical route: POST /products/:id/listings.
export interface CreateProductListingInput {
  productId: string;
  marketplaceKey?: Marketplace['key'];
  price?: number;
}

// Canonical route: POST /listings/:id/publish with optional body { actorId? }.
export interface PublishListingInput {
  id: string;
  actorId?: string;
  dryRun?: boolean;
}

export interface PublishListingPreview {
  dryRun: true;
  canPublish: boolean;
  listingId: string;
  status: ListingStatus;
  marketplaceKey?: Marketplace['key'];
  payload: {
    productName: string;
    description: string;
    price: number;
    currency: string;
    category: string;
    condition: Product['condition'];
    imageCount: number;
  } | null;
  warnings: string[];
}

// Canonical route: PATCH /listings/:id with body { price, reason? }.
export interface UpdateListingInput {
  price: number;
  reason?: string;
}

export interface UpdateListingArg {
  id: string;
  patch: UpdateListingInput;
}

// ----------------------------------------------------------------------------
// Marketplaces
// ----------------------------------------------------------------------------

export interface ConnectMarketplaceInput {
  code?: string;
  handle?: string;
  scopes?: string[];
}

export type UpdateMarketplaceInput = Partial<
  Pick<Marketplace, 'syncMode' | 'connected' | 'capacity'>
> & { syncMode?: SyncMode };

export interface UpdateMarketplaceArg {
  id: string;
  patch: UpdateMarketplaceInput;
}

// ----------------------------------------------------------------------------
// Hermes
// ----------------------------------------------------------------------------

export interface HermesEventListParams {
  workspaceId?: string;
  status?: HermesEventStatus[];
  severity?: HermesSeverity[];
  sort?: string;
  limit?: number;
  offset?: number;
}

// POST /hermes/run body — workspace is derived from the authenticated session.
export interface HermesRunInput {
  trigger?: 'scheduled' | 'manual' | 'event';
}

// POST /hermes/run responds with the array of generated events (HermesEventView[]).

export type HermesEventResolution = HermesEvent;

// ----------------------------------------------------------------------------
// Analytics (no shared entity — response shapes defined here)
// ----------------------------------------------------------------------------

export interface AnalyticsQueryParams {
  workspaceId?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  interval?: 'day' | 'week' | 'month';
}

// GET /analytics/overview → dashboard aggregates. `previous` is always present
// (null until a historical analytics source is wired) and carries the same shape
// minus its own `previous`, so delta tiles can compare period-over-period.
export interface AnalyticsOverview {
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
  previous: Omit<AnalyticsOverview, 'previous'> | null;
}

export interface RevenuePoint {
  date: string; // ISO date bucket
  revenue: number;
  previous: number | null;
}

// GET /analytics/revenue → { series, currency }. `series` is always an array
// (empty until historical data is wired); `currency` is null when unknown.
export interface AnalyticsRevenue {
  series: RevenuePoint[];
  currency: string | null;
}

// GET /analytics/listings → per-listing performance rows.
export interface ListingPerformance {
  listingId: string;
  productId: string;
  status: ListingStatus;
  price: number;
  views: number;
  watchers: number;
  messages: number;
}
