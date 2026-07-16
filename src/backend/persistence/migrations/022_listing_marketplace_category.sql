ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS marketplace_category JSONB;

COMMENT ON COLUMN listings.marketplace_category IS
  'Exact provider leaf category metadata: ID/path/source/confidence and taxonomy freshness';

-- Recreate is quota-equivalent to a new publication. Replace the legacy check
-- only once; NOT VALID avoids scanning/blocking the live table in this migration.
DO $$
DECLARE
  constraint_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO constraint_definition
    FROM pg_constraint
   WHERE conname = 'olx_publication_operations_mode_valid'
     AND conrelid = 'olx_publication_operations'::regclass;

  IF constraint_definition IS NULL OR position('recreate' in constraint_definition) = 0 THEN
    ALTER TABLE olx_publication_operations
      DROP CONSTRAINT IF EXISTS olx_publication_operations_mode_valid;
    ALTER TABLE olx_publication_operations
      ADD CONSTRAINT olx_publication_operations_mode_valid
      CHECK (mode IN ('publish', 'relist', 'recreate')) NOT VALID;
  END IF;
END
$$;
