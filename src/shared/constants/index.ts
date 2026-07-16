// Shared constants for backend and frontend.
// Authoritative source: ARCHITECTURE.md §3 / §7 and ARCHITECTURE_AMENDMENTS.

import type {
  MarketplaceKey,
  SyncMode,
  ProductStatus,
  ListingStatus,
  AutonomyLevel,
  HermesSeverity,
  HermesEventStatus,
  AutonomyDecision,
  AnalyticsEventType,
} from '../types';

// Marketplace keys (the 7 supported markets)
export const MARKETPLACE_KEYS = {
  OLX: 'olx',
  ALLEGRO: 'allegro',
  VINTED: 'vinted',
  FACEBOOK: 'facebook',
  EBAY: 'ebay',
  ETSY: 'etsy',
  AMAZON: 'amazon',
} as const;

export const MARKETPLACE_KEY_LIST: readonly MarketplaceKey[] = [
  'olx',
  'allegro',
  'vinted',
  'facebook',
  'ebay',
  'etsy',
  'amazon',
];

// Human-readable marketplace names
export const MARKETPLACE_NAMES: Record<MarketplaceKey, string> = {
  olx: 'OLX',
  allegro: 'Allegro',
  vinted: 'Vinted',
  facebook: 'Facebook Marketplace',
  ebay: 'eBay',
  etsy: 'Etsy',
  amazon: 'Amazon',
};

// Marketplace sync modes
export const SYNC_MODES = {
  REALTIME: 'realtime',
  HOURLY: 'hourly',
  MANUAL: 'manual',
} as const;

export const SYNC_MODE_LIST: readonly SyncMode[] = ['realtime', 'hourly', 'manual'];

// Product statuses (forward-only: draft -> active -> attention -> sold)
export const PRODUCT_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ATTENTION: 'attention',
  SOLD: 'sold',
} as const;

export const PRODUCT_STATUS_LIST: readonly ProductStatus[] = [
  'draft',
  'active',
  'attention',
  'sold',
];

// Listing statuses
export const LISTING_STATUS = {
  LIVE: 'live',
  DRAFT: 'draft',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const;

export const LISTING_STATUS_LIST: readonly ListingStatus[] = [
  'live',
  'draft',
  'expired',
  'error',
];

// Autonomy levels
export const AUTONOMY_LEVELS = {
  SUGGEST_ONLY: 'suggest_only',
  BALANCED: 'balanced',
  FULL_AUTO: 'full_auto',
} as const;

export const AUTONOMY_LEVEL_LIST: readonly AutonomyLevel[] = [
  'suggest_only',
  'balanced',
  'full_auto',
];

// Hermes event severities
export const HERMES_SEVERITIES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;

export const HERMES_SEVERITY_LIST: readonly HermesSeverity[] = [
  'info',
  'success',
  'warning',
  'critical',
];

// Hermes event statuses
export const HERMES_EVENT_STATUS = {
  PENDING_REVIEW: 'pending_review',
  APPLIED: 'applied',
  DISMISSED: 'dismissed',
} as const;

export const HERMES_EVENT_STATUS_LIST: readonly HermesEventStatus[] = [
  'pending_review',
  'applied',
  'dismissed',
];

// Autonomy decisions
export const AUTONOMY_DECISIONS = {
  AUTO_APPLY: 'auto_apply',
  PENDING_REVIEW: 'pending_review',
} as const;

export const AUTONOMY_DECISION_LIST: readonly AutonomyDecision[] = [
  'auto_apply',
  'pending_review',
];

// Analytics event types
export const ANALYTICS_EVENT_TYPES = {
  VIEW: 'view',
  MESSAGE: 'message',
  SALE: 'sale',
} as const;

export const ANALYTICS_EVENT_TYPE_LIST: readonly AnalyticsEventType[] = [
  'view',
  'message',
  'sale',
];

// Hermes event types Balanced autonomy will auto-apply (safe operations)
export const BALANCED_SAFE_EVENT_TYPES: readonly string[] = [
  'create_listing',
  'update_description',
  'relist',
];

// Default guardrails (ARCHITECTURE_AMENDMENTS FIX #5)
export const DEFAULT_HERMES_GUARDRAILS = {
  maxAutoPriceChangePct: 15,
  minMarginFloor: 20,
  autoCreateListings: false,
  autoAdjustPricing: false,
  autoRelist: false,
  smartTitleAndSEO: false,
} as const;

// Critical price-drop threshold: drops beyond this fraction always await review.
export const CRITICAL_PRICE_DROP_THRESHOLD = 0.2; // 20%

// Domain defaults
export const DEFAULT_CURRENCY = 'PLN';
export const DEFAULT_TIMEZONE = 'Europe/Warsaw';

// Product invariants
export const PRODUCT_DESCRIPTION_MIN_LENGTH = 20;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// API
export const API_BASE_URL = '/api';
export const API_VERSION = 'v1';

// Error Codes
export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_STATE: 'INVALID_STATE',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  SHORT: 5 * 60,
  MEDIUM: 30 * 60,
  LONG: 24 * 60 * 60,
} as const;
