-- Durable guard/checkpoint around non-idempotent marketplace publish calls.
-- A 'publishing' row makes an ambiguous provider outcome fail closed; a
-- 'published' row lets Bull resume local finalization without another POST.
CREATE TABLE IF NOT EXISTS marketplace_publish_attempts (
  operation_id UUID PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  listing_updated_at TIMESTAMPTZ NOT NULL,
  marketplace_key VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  external_listing_id VARCHAR(255),
  external_url TEXT,
  published_at TIMESTAMPTZ,
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

-- The migration runner is idempotent rather than version-tracked, so this also
-- upgrades a table created by an earlier revision of this migration.
ALTER TABLE marketplace_publish_attempts
  ADD COLUMN IF NOT EXISTS listing_updated_at TIMESTAMPTZ;

ALTER TABLE marketplace_publish_attempts
  ADD COLUMN IF NOT EXISTS external_url TEXT;

UPDATE marketplace_publish_attempts
SET listing_updated_at = created_at
WHERE listing_updated_at IS NULL;

ALTER TABLE marketplace_publish_attempts
  ALTER COLUMN listing_updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_publish_attempts_listing
  ON marketplace_publish_attempts(listing_id);
