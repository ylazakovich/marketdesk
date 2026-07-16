-- MarketDesk Full Database Schema
-- Authoritative source: ARCHITECTURE.md §7 (+ ARCHITECTURE_AMENDMENTS FIX #6, #7)
--
-- This is the consolidated schema. It mirrors the ordered migrations under
-- persistence/migrations/. Notes:
--   * PostgreSQL has no inline INDEX in CREATE TABLE -> all indexes are separate.
--   * `JSONB NOT NULL ENCRYPTED` is invalid SQL. Credentials are a plain JSONB;
--     encryption is done in the application layer (CredentialVault, §9).
--   * `users` is a pragmatic v1 auth addition (JWT). Full RBAC is Phase 2.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Workspaces (multi-tenancy root) & Users (v1 auth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(3) DEFAULT 'PLN',
  timezone VARCHAR(100) DEFAULT 'Europe/Warsaw',
  autonomy_level VARCHAR(50) DEFAULT 'suggest_only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- Products, Tags, Images
-- ============================================================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  cost_price DECIMAL(10, 2) NOT NULL,
  selling_price DECIMAL(10, 2) NOT NULL,
  condition VARCHAR(50) NOT NULL,
  category VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_price CHECK (selling_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_workspace_status ON products(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(workspace_id, sku);

CREATE TABLE IF NOT EXISTS product_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_tags_product ON product_tags(product_id);

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url VARCHAR(500) NOT NULL,
  position INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

-- ============================================================================
-- Marketplaces & Marketplace Accounts
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketplaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  connected BOOLEAN DEFAULT FALSE,
  sync_mode VARCHAR(50) DEFAULT 'manual',
  last_sync_at TIMESTAMP,
  error_count INT DEFAULT 0,
  capacity INT DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_marketplace UNIQUE (workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_marketplaces_workspace ON marketplaces(workspace_id);

CREATE TABLE IF NOT EXISTS marketplace_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  handle VARCHAR(255) NOT NULL,
  credentials JSONB NOT NULL, -- app-layer encrypted (see CredentialVault §9)
  status VARCHAR(50) DEFAULT 'connected',
  scopes TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_accounts_marketplace ON marketplace_accounts(marketplace_id);

CREATE TABLE IF NOT EXISTS olx_publication_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  subcategory_id VARCHAR(100) NOT NULL,
  cycle_started_at TIMESTAMPTZ NOT NULL,
  cycle_ends_at TIMESTAMPTZ NOT NULL,
  publication_limit INT NOT NULL,
  consumed INT NOT NULL DEFAULT 0,
  source VARCHAR(50) NOT NULL,
  confidence VARCHAR(30) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  stale_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT olx_publication_quotas_subcategory_not_blank CHECK (btrim(subcategory_id) <> ''),
  CONSTRAINT olx_publication_quotas_cycle_valid CHECK (cycle_started_at < cycle_ends_at),
  CONSTRAINT olx_publication_quotas_counts_valid CHECK (publication_limit >= 0 AND consumed >= 0),
  CONSTRAINT olx_publication_quotas_source_valid CHECK (source IN ('operator', 'provider', 'reconciled')),
  CONSTRAINT olx_publication_quotas_confidence_valid CHECK (confidence IN ('verified', 'estimated')),
  CONSTRAINT olx_publication_quotas_staleness_valid CHECK (verified_at < stale_at),
  CONSTRAINT uq_olx_publication_quota_cycle
    UNIQUE (workspace_id, marketplace_account_id, subcategory_id, cycle_started_at)
);
CREATE INDEX IF NOT EXISTS idx_olx_publication_quotas_lookup
  ON olx_publication_quotas
  (workspace_id, marketplace_id, marketplace_account_id, subcategory_id, cycle_started_at DESC);

CREATE TABLE IF NOT EXISTS olx_publication_operations (
  operation_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  quota_id UUID REFERENCES olx_publication_quotas(id) ON DELETE SET NULL,
  listing_id UUID NOT NULL,
  subcategory_id VARCHAR(100) NOT NULL,
  mode VARCHAR(20) NOT NULL,
  decision VARCHAR(20) NOT NULL,
  quota_status VARCHAR(30) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  consumed_unit BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  actor_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT olx_publication_operations_mode_valid CHECK (mode IN ('publish', 'relist')),
  CONSTRAINT olx_publication_operations_decision_valid CHECK (decision IN ('allow', 'block', 'override')),
  CONSTRAINT olx_publication_operations_status_valid
    CHECK (quota_status IN ('available', 'exhausted', 'stale', 'unverified', 'unknown')),
  CONSTRAINT olx_publication_operations_override_valid CHECK (
    (decision = 'override' AND override_reason IS NOT NULL AND btrim(override_reason) <> '')
    OR (decision <> 'override' AND override_reason IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_olx_publication_operations_listing
  ON olx_publication_operations(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_olx_publication_operations_quota
  ON olx_publication_operations(quota_id, created_at DESC);

-- ============================================================================
-- Listings & Price History
-- ============================================================================

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id),
  marketplace_listing_id VARCHAR(255),
  external_url TEXT,
  price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  remote_status VARCHAR(100),
  views INT DEFAULT 0,
  watchers INT DEFAULT 0,
  messages INT DEFAULT 0,
  published_at TIMESTAMP,
  expires_at TIMESTAMP,
  sync_error TEXT,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_listing UNIQUE (product_id, marketplace_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_product ON listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_marketplace ON listings(marketplace_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_expires ON listings(expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_marketplace_status ON listings(marketplace_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_olx_publication_operations_listing'
  ) THEN
    ALTER TABLE olx_publication_operations
      ADD CONSTRAINT fk_olx_publication_operations_listing
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS marketplace_publish_attempts (
  operation_id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_updated_at TIMESTAMPTZ NOT NULL,
  marketplace_key VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  external_listing_id VARCHAR(255),
  external_url TEXT,
  published_at TIMESTAMPTZ,
  remote_status VARCHAR(100),
  remote_image_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marketplace_publish_attempts_status_valid
    CHECK (status IN ('publishing', 'published', 'finalized', 'abandoned')),
  CONSTRAINT marketplace_publish_attempts_state_valid CHECK (
    (status = 'publishing' AND external_listing_id IS NULL)
    OR (status IN ('published', 'finalized') AND external_listing_id IS NOT NULL)
    OR status = 'abandoned'
  )
);

CREATE INDEX IF NOT EXISTS idx_marketplace_publish_attempts_listing
  ON marketplace_publish_attempts(listing_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_publish_attempts_listing_generation
  ON marketplace_publish_attempts(listing_id, listing_updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_publish_attempts_active_listing
  ON marketplace_publish_attempts(listing_id)
  WHERE status IN ('publishing', 'published');

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  old_price DECIMAL(10, 2),
  new_price DECIMAL(10, 2) NOT NULL,
  changed_by VARCHAR(50) NOT NULL, -- 'user' | 'hermes'
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_price_history_created ON price_history(created_at);
CREATE INDEX IF NOT EXISTS idx_price_history_listing_date ON price_history(listing_id, created_at DESC);

-- ============================================================================
-- Hermes Events (AI event log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS hermes_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL CONSTRAINT hermes_events_status_check CHECK (status IN (
    'pending_decision', 'pending_review', 'applying', 'applied',
    'dismissed', 'failed', 'reverting', 'reverted'
  )),
  title VARCHAR(255) NOT NULL,
  detail TEXT,
  proposed_change JSONB,
  autonomy_decision VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  CONSTRAINT hermes_events_resolution_check CHECK (
    (status IN ('applied', 'dismissed', 'failed', 'reverted')) = (resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hermes_events_workspace ON hermes_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_hermes_events_product ON hermes_events(product_id);
CREATE INDEX IF NOT EXISTS idx_hermes_events_status ON hermes_events(status);
CREATE INDEX IF NOT EXISTS idx_hermes_events_created ON hermes_events(created_at);

-- ============================================================================
-- Activity Log, Analytics Events, API Keys
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  actor_type VARCHAR(50) NOT NULL, -- 'user' | 'hermes'
  actor_id VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_workspace_date ON activity_log(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL, -- 'view' | 'message' | 'sale'
  quantity INT DEFAULT 1,
  amount DECIMAL(10, 2),
  cost_at_sale DECIMAL(10, 2),
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_workspace_type ON analytics_events(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_listing ON analytics_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_analytics_occurred ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_workspace_date ON analytics_events(workspace_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
