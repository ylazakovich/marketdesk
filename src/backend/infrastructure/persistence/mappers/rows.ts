// Raw database row shapes (snake_case) as returned by node-pg. These describe
// the exact columns each repository SELECTs, including any joined `currency`
// column used to reconstruct Money value objects.

import type { ProposedChange, HermesGuardrails, MarketplaceCategoryMetadata } from '../../../../shared/types';

export interface ProductRow {
  id: string;
  workspace_id: string;
  sku: string;
  name: string;
  description: string;
  cost_price: string | number | null;
  selling_price: string | number;
  condition: string;
  category: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined from workspaces.currency (products have no own currency column).
  currency: string;
}

export interface ProductTagRow {
  tag: string;
}

export interface ProductImageRow {
  url: string;
  position: number;
}

export interface ListingRow {
  id: string;
  product_id: string;
  marketplace_id: string;
  marketplace_listing_id: string | null;
  external_url: string | null;
  price: string | number;
  status: string;
  remote_status: string | null;
  marketplace_category: MarketplaceCategoryMetadata | null;
  views: number | null;
  watchers: number | null;
  messages: number | null;
  published_at: Date | string | null;
  expires_at: Date | string | null;
  sync_error: string | null;
  last_sync_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // Joined via products -> workspaces.
  currency: string;
}

export interface MarketplaceRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  connected: boolean;
  sync_mode: string;
  last_sync_at: Date | string | null;
  error_count: number;
  capacity: number;
  created_at: Date | string;
}

export interface HermesEventRow {
  id: string;
  workspace_id: string;
  product_id: string | null;
  type: string;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
  proposed_change: ProposedChange;
  autonomy_decision: string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  autonomy_level: string;
  // JSONB column (migration 007). node-pg parses JSONB to an object; NULL when
  // unset, in which case the mapper falls back to DEFAULT_HERMES_GUARDRAILS.
  guardrails?: HermesGuardrails | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ActivityLogRow {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}
