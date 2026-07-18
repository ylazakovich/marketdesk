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
  MarketplaceCategoryMetadata,
  CategoryRecreationOperationAction,
  CategoryRecreationOperationStatus,
} from '@shared/types';

// ----------------------------------------------------------------------------
// Products
// ----------------------------------------------------------------------------

export interface ProductListParams {
  workspaceId?: string;
  search?: string;
  status?: ProductStatus[];
  priceMin?: number;
  priceMax?: number;
  tags?: string[];
  sort?: string; // e.g. "-updatedAt,+name"
  limit?: number;
  offset?: number;
}

export type CreateProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & {
  allowBelowCost?: boolean;
};

export type UpdateProductInput = Partial<
  Omit<Product, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>
> & { allowBelowCost?: boolean };

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
  quotaOverride?: {
    confirmed: true;
    reason: string;
  };
}

export interface DelistListingToDraftInput {
  id: string;
  operationId: string;
  confirmed: true;
}

export interface ListingDelistOperation {
  id: string;
  listingId: string;
  marketplaceId: string;
  state: 'requested' | 'approved' | 'executing' | 'executed' | 'failed';
  result: Record<string, unknown> | null;
}

export interface PublishListingPreview {
  dryRun: true;
  canPublish: boolean;
  quotaOverrideEligibility: {
    eligible: boolean;
    reason: string | null;
  };
  listingId: string;
  status: ListingStatus;
  marketplaceKey?: Marketplace['key'];
  payload: {
    productName: string;
    description: string;
    price: number;
    currency: string;
    category: string;
    marketplaceCategory?: MarketplaceCategoryMetadata | null;
    condition: Product['condition'];
    imageCount: number;
  } | null;
  warnings: string[];
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  quotaDecision?: {
    status: string;
    decision: string;
    reason: string;
    subcategoryId?: string;
  };
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
  returnTo?: string;
}

export interface MarketplaceOAuthStart {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export interface MarketplaceOAuthStatus {
  connected: boolean;
  marketplaceId: string;
  providerKey: Marketplace['key'];
  account: {
    id: string;
    handle: string;
    status: 'connected' | 'disconnected' | 'error';
    scopes: string[];
  } | null;
  tokenExpiresAt?: string;
  refreshable: boolean;
}

export interface MarketplaceAppCredentialStatus {
  configured: boolean;
  marketplaceId: string;
  providerKey: Marketplace['key'];
  clientId?: string;
  updatedAt?: string;
}

export interface SaveMarketplaceAppCredentialsInput {
  clientId: string;
  clientSecret: string;
}

export interface SaveMarketplaceAppCredentialsArg {
  id: string;
  input: SaveMarketplaceAppCredentialsInput;
}

export type UpdateMarketplaceInput = Partial<
  Pick<Marketplace, 'syncMode' | 'connected' | 'capacity'>
> & { syncMode?: SyncMode };

export interface UpdateMarketplaceArg {
  id: string;
  patch: UpdateMarketplaceInput;
}

export interface MarketplaceImportPreviewInput {
  id: string;
  pageSize?: number;
  statuses?: string[];
}

export interface MarketplaceImportApplyInput extends MarketplaceImportPreviewInput {
  externalListingIds?: string[];
}

export type MarketplaceImportPreviewItemStatus =
  'new' | 'already_imported' | 'changed' | 'unsupported' | 'failed';

export interface MarketplaceImportPreviewItem {
  status: MarketplaceImportPreviewItemStatus;
  externalListingId: string;
  externalUrl?: string | null;
  title: string;
  remoteStatus: string | null;
  warnings: string[];
  proposed: {
    externalListingId: string;
    externalUrl?: string | null;
    title: string;
    description?: string | null;
    price?: number | null;
    currency?: string | null;
    status: ListingStatus;
    remoteStatus?: string | null;
    category?: string | null;
    imageUrls: string[];
    remoteUpdatedAt?: string | null;
    metrics?: { views?: number; watchers?: number; messages?: number };
  };
}

export interface MarketplaceImportPreview {
  marketplaceId: string;
  marketplaceKey: Marketplace['key'];
  readOnly: true;
  totals: Record<MarketplaceImportPreviewItemStatus, number> & { discovered: number };
  items: MarketplaceImportPreviewItem[];
}

export interface MarketplaceImportApplyResult {
  marketplaceId: string;
  marketplaceKey: Marketplace['key'];
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  results: Array<{
    externalListingId: string;
    status: 'imported' | 'updated' | 'skipped' | 'failed';
    productId?: string;
    listingId?: string;
    reason?: string;
  }>;
}

// ----------------------------------------------------------------------------
// Hermes
// ----------------------------------------------------------------------------

export interface HermesEventListParams {
  workspaceId?: string;
  productId?: string;
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

/** Contract expected from separately durable and audited category operations. */
export interface CategoryRecreationOperationCommand {
  action: CategoryRecreationOperationAction;
  operation: 'delist' | 'recreate';
  paidOverrideReason?: string;
}

export interface CategoryRecreationOperationResolution {
  id: string;
  recommendationEventId: string;
  kind: 'delist' | 'recreate';
  state: 'requested' | 'approved' | 'executing' | 'executed' | 'failed';
  result: Record<string, unknown> | null;
}

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
