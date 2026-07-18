// Shared types between backend and frontend.
// Authoritative source: ARCHITECTURE.md §3 (Domain Model) and §7 (Database Schema).
// These are transport/persistence-facing shapes (dates as ISO strings). The domain
// layer maps these to rich entities (see src/backend/domain).

// ============================================================================
// String-literal unions (single source of truth for the domain vocabulary)
// ============================================================================

export type MarketplaceKey = 'olx' | 'allegro' | 'vinted' | 'facebook' | 'ebay' | 'etsy' | 'amazon';

export type SyncMode = 'realtime' | 'hourly' | 'manual';

export type MarketplaceAccountStatus = 'connected' | 'disconnected' | 'error';

export type ProductStatus = 'draft' | 'active' | 'attention' | 'sold';

export type ProductCondition =
  'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'refurbished' | 'unknown';

export type ListingStatus = 'live' | 'draft' | 'expired' | 'error';

export type MarketplaceCategorySource = 'provider_taxonomy' | 'remote_import' | 'user_confirmed';

export interface MarketplaceCategoryMetadata {
  providerCategoryId: string;
  name: string;
  path: string[];
  source: MarketplaceCategorySource;
  confidence: number;
  isLeaf: boolean;
  taxonomyVerifiedAt: string;
  taxonomyStaleAt: string;
}

export interface ProductCategorySource {
  marketplaceKey: MarketplaceKey;
  marketplaceId: string;
  listingId: string;
  providerCategoryId: string;
  name: string;
  path: string[];
  taxonomyVerifiedAt: string;
  syncedAt: string;
}

export type ProductCategoryProvenance =
  | { status: 'synced'; sources: ProductCategorySource[] }
  | {
      status: 'conflict';
      currentSources: ProductCategorySource[] | null;
      candidates: ProductCategorySource[];
      detectedAt: string;
    };

export type AutonomyLevel = 'suggest_only' | 'balanced' | 'full_auto';

export type HermesSeverity = 'info' | 'success' | 'warning' | 'critical';

/** Persisted/API lifecycle values. UI labels are mapped separately in Badge.tsx. */
export const HERMES_EVENT_STATUSES = [
  'pending_decision',
  'pending_review',
  'applying',
  'applied',
  'dismissed',
  'failed',
  'reverting',
  'reverted',
] as const;
export type HermesEventStatus = (typeof HERMES_EVENT_STATUSES)[number];

export type AutonomyDecision = 'auto_apply' | 'pending_review';

export type HermesEventType =
  | 'suggested_lower_price'
  | 'suggested_higher_price'
  | 'needs_relisting'
  | 'competitor_price_detected'
  | 'suggested_better_title'
  | 'suggested_more_photos'
  | 'create_listing'
  | 'update_description'
  | 'olx_category_mismatch'
  | 'product_category_conflict'
  | 'relist';

export type ChangedBy = 'user' | 'hermes';

export type ActorType = 'user' | 'hermes';

export type AnalyticsEventType = 'view' | 'message' | 'sale';

// ============================================================================
// Proposed change payloads (fully typed JSONB for hermes_events.proposed_change)
// ============================================================================

export interface PriceChangePayload {
  kind: 'price';
  field: 'price';
  from: number;
  to: number;
}

export interface TitleChangePayload {
  kind: 'title';
  field: 'title';
  from: string;
  to: string;
}

export interface DescriptionChangePayload {
  kind: 'description';
  field: 'description';
  from: string;
  to: string;
}

export interface RelistChangePayload {
  kind: 'relist';
  action: 'relist';
  listingIds: string[];
}

export interface CreateListingChangePayload {
  kind: 'create_listing';
  marketplaceKey: MarketplaceKey;
}

export interface ProductCategoryConflictChangePayload {
  kind: 'product_category_conflict';
  productId: string;
  currentCategory: string;
  candidates: ProductCategorySource[];
}

export type CategoryRecreationOperationStatus =
  | 'pending_review'
  | 'blocked_pending_quota_review'
  | 'approved'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

/**
 * Server-authorized operation capability. The UI never invents an execution
 * route: an action is enabled only when the authenticated API includes one of
 * these relative links in the event representation.
 */
export type CategoryRecreationOperationAction = {
  [Action in 'approve' | 'execute']: {
    kind: Action;
    method: 'POST';
    href: `/hermes/category-correction-operations/${string}/${Action}`;
    label?: string;
  };
}['approve' | 'execute'];

export interface CategoryRecreationQuotaReview {
  status: 'available' | 'unknown' | 'stale' | 'exhausted' | 'paid_risk';
  cycleStartedAt?: string;
  cycleEndsAt?: string;
  remaining?: number | null;
  paidRisk: boolean;
  reason?: string;
}

export interface CategoryRecreationChangePayload {
  kind: 'category_recreation';
  listingId: string;
  currentCategory: MarketplaceCategoryMetadata;
  /** Null until a trusted server-side taxonomy selection is available. */
  proposedCategory: MarketplaceCategoryMetadata | null;
  operations: readonly [
    {
      kind: 'delist';
      intentId: string;
      status: CategoryRecreationOperationStatus;
      providerSideEffectAllowed: boolean;
      quotaUnitsRestored: 0;
      availableActions?: CategoryRecreationOperationAction[];
      failureReason?: string;
    },
    {
      kind: 'recreate';
      intentId: string;
      status: CategoryRecreationOperationStatus;
      providerSideEffectAllowed: boolean;
      quotaGuardRequired: true;
      quota?: CategoryRecreationQuotaReview;
      availableActions?: CategoryRecreationOperationAction[];
      failureReason?: string;
    },
  ];
}

export type ProposedChange =
  | PriceChangePayload
  | TitleChangePayload
  | DescriptionChangePayload
  | RelistChangePayload
  | CreateListingChangePayload
  | ProductCategoryConflictChangePayload
  | CategoryRecreationChangePayload
  | null;

// ============================================================================
// Auth (v1 addition; full RBAC is Phase 2)
// ============================================================================

export interface User {
  id: string;
  email: string;
  workspaceId?: string;
  createdAt: string;
}

// ============================================================================
// Guardrails (ARCHITECTURE_AMENDMENTS FIX #5)
// ============================================================================

export interface HermesGuardrails {
  maxAutoPriceChangePct: number;
  minMarginFloor: number;
  autoCreateListings: boolean;
  autoAdjustPricing: boolean;
  autoRelist: boolean;
  smartTitleAndSEO: boolean;
}

// ============================================================================
// Core entities
// ============================================================================

export interface Workspace {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  language: import('./settings').WorkspaceLanguage;
  autonomyLevel: AutonomyLevel;
  guardrails?: HermesGuardrails;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  workspaceId: string;
  sku: string;
  name: string;
  description: string;
  costPrice: number | null;
  sellingPrice: number;
  condition: ProductCondition;
  category: string;
  categoryProvenance?: ProductCategoryProvenance | null;
  status: ProductStatus;
  tags: string[];
  images: string[];
  createdAt: string;
  updatedAt: string;
}

export type ProductAIDraftMode = 'photos' | 'title';

export type ProductAIDraftFields = Partial<
  Pick<
    Product,
    | 'sku'
    | 'name'
    | 'description'
    | 'costPrice'
    | 'sellingPrice'
    | 'condition'
    | 'category'
    | 'status'
    | 'tags'
    | 'images'
  >
>;

export interface ProductAIDraftRequest {
  mode: ProductAIDraftMode;
  title?: string;
  imageUrls?: string[];
  existingFields?: ProductAIDraftFields;
}

export interface ProductAIDraft {
  mode: ProductAIDraftMode;
  fields: ProductAIDraftFields;
  confidence: number;
  uncertainFields: Array<keyof ProductAIDraftFields>;
  missingInfoQuestions: string[];
  notes: string[];
}

export interface Marketplace {
  id: string;
  workspaceId: string;
  key: MarketplaceKey;
  name: string;
  connected: boolean;
  syncMode: SyncMode;
  lastSyncAt?: string;
  errorCount: number;
  capacity: number;
  createdAt: string;
}

export interface MarketplaceAccount {
  id: string;
  marketplaceId: string;
  handle: string;
  status: MarketplaceAccountStatus;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: string;
  productId: string;
  productName?: string;
  productSku?: string;
  marketplaceId: string;
  marketplaceListingId?: string;
  externalUrl?: string;
  price: number;
  status: ListingStatus;
  remoteStatus?: string;
  marketplaceCategory?: MarketplaceCategoryMetadata;
  remoteStatusLabel?: string;
  isRemotePending?: boolean;
  views: number | null;
  watchers: number | null;
  messages: number | null;
  metricsAvailability?: {
    views: boolean;
    watchers: boolean;
    messages: boolean;
  };
  publishedAt?: string;
  expiresAt?: string;
  syncError?: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HermesEvent {
  id: string;
  workspaceId: string;
  productId?: string;
  type: HermesEventType;
  severity: HermesSeverity;
  status: HermesEventStatus;
  title: string;
  detail?: string;
  proposedChange: ProposedChange;
  autonomyDecision?: AutonomyDecision;
  createdAt: string;
  resolvedAt?: string;
}

export interface PriceHistory {
  id: string;
  listingId: string;
  oldPrice?: number;
  newPrice: number;
  changedBy: ChangedBy;
  reason?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AnalyticsEvent {
  id: string;
  workspaceId: string;
  listingId?: string;
  eventType: AnalyticsEventType;
  quantity: number;
  amount?: number;
  costAtSale?: number;
  occurredAt: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  workspaceId: string;
  name: string;
  lastUsedAt?: string;
  revoked: boolean;
  createdAt: string;
}

// ============================================================================
// Generic API envelopes
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    timestamp: string;
    version: string;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export * from './settings';
