-- Upgrade databases that may have run the initial publish-attempt migration
-- before listing-generation serialization and finalized checkpoints were added.
SELECT pg_advisory_xact_lock(hashtext('marketdesk:upgrade-publish-attempts'));

ALTER TABLE marketplace_publish_attempts
  ADD COLUMN IF NOT EXISTS listing_updated_at TIMESTAMPTZ;

UPDATE marketplace_publish_attempts
SET listing_updated_at = created_at
WHERE listing_updated_at IS NULL;

ALTER TABLE marketplace_publish_attempts
  ALTER COLUMN listing_updated_at SET NOT NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'marketplace_publish_attempts'::regclass
      AND conname = 'marketplace_publish_attempts_status_valid'
  ) THEN
    FOR constraint_name IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'marketplace_publish_attempts'::regclass
        AND contype = 'c'
    LOOP
      EXECUTE format(
        'ALTER TABLE marketplace_publish_attempts DROP CONSTRAINT %I',
        constraint_name
      );
    END LOOP;

    ALTER TABLE marketplace_publish_attempts
      ADD CONSTRAINT marketplace_publish_attempts_status_valid
        CHECK (status IN ('publishing', 'published', 'finalized', 'abandoned')),
      ADD CONSTRAINT marketplace_publish_attempts_state_valid
        CHECK (
          (status = 'publishing' AND external_listing_id IS NULL)
          OR (status IN ('published', 'finalized') AND external_listing_id IS NOT NULL)
          OR status = 'abandoned'
        );
  END IF;
END
$$;

-- Preserve one fail-closed active attempt per listing. Any duplicate remnants from
-- the pre-serialization schema remain auditable but cannot issue provider calls.
WITH ranked AS (
  SELECT operation_id,
         ROW_NUMBER() OVER (
           PARTITION BY listing_id
           ORDER BY created_at ASC, operation_id ASC
         ) AS position
  FROM marketplace_publish_attempts
  WHERE status IN ('publishing', 'published')
)
UPDATE marketplace_publish_attempts AS attempt
SET status = 'abandoned', updated_at = NOW()
FROM ranked
WHERE attempt.operation_id = ranked.operation_id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_publish_attempts_listing_generation
  ON marketplace_publish_attempts(listing_id, listing_updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_publish_attempts_active_listing
  ON marketplace_publish_attempts(listing_id)
  WHERE status IN ('publishing', 'published');
