-- Durable guard/checkpoint around non-idempotent marketplace publish calls.
-- A 'publishing' row makes an ambiguous provider outcome fail closed; a
-- 'published' row lets Bull resume local finalization without another POST.
CREATE TABLE IF NOT EXISTS marketplace_publish_attempts (
  operation_id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  marketplace_key VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('publishing', 'published')),
  external_listing_id VARCHAR(255),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'publishing' AND external_listing_id IS NULL)
    OR (status = 'published' AND external_listing_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_marketplace_publish_attempts_listing
  ON marketplace_publish_attempts(listing_id);
