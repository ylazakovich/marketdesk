ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS marketplace_category JSONB;

COMMENT ON COLUMN listings.marketplace_category IS
  'Exact provider leaf category metadata: ID/path/source/confidence and taxonomy freshness';

-- Recreate is quota-equivalent to a new publication, but remains a distinct
-- audited intent. This migration does not execute any provider operation.
ALTER TABLE olx_publication_operations
  DROP CONSTRAINT IF EXISTS olx_publication_operations_mode_valid;
ALTER TABLE olx_publication_operations
  ADD CONSTRAINT olx_publication_operations_mode_valid
  CHECK (mode IN ('publish', 'relist', 'recreate'));