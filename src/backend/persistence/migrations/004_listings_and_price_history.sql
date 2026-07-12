-- Migration 004: Listings (per product × marketplace) and Price History
-- Authoritative source: ARCHITECTURE.md §7

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id),
  marketplace_listing_id VARCHAR(255),
  price DECIMAL(10, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
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
