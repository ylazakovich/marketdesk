-- Separate durable lifecycle records for destructive OLX category correction.
-- This migration creates audit state only and performs no provider effects.
CREATE TABLE IF NOT EXISTS category_correction_operations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recommendation_event_id UUID NOT NULL REFERENCES hermes_events(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'requested',
  target_category JSONB,
  paid_override_reason TEXT,
  requested_by VARCHAR(100),
  approved_by VARCHAR(100),
  result JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT category_correction_operations_kind_valid CHECK (kind IN ('delist', 'recreate')),
  CONSTRAINT category_correction_operations_state_valid
    CHECK (state IN ('requested', 'approved', 'executing', 'executed', 'failed')),
  CONSTRAINT category_correction_operations_target_valid CHECK (
    (kind = 'delist' AND target_category IS NULL AND paid_override_reason IS NULL)
    OR (kind = 'recreate' AND (state = 'requested' OR target_category IS NOT NULL))
  ),
  CONSTRAINT category_correction_operations_lifecycle_valid CHECK (
    (state = 'requested' AND approved_at IS NULL AND executed_at IS NULL AND failed_at IS NULL)
    OR (state IN ('approved', 'executing') AND approved_at IS NOT NULL AND executed_at IS NULL AND failed_at IS NULL)
    OR (state = 'executed' AND approved_at IS NOT NULL AND executed_at IS NOT NULL AND failed_at IS NULL)
    OR (state = 'failed' AND approved_at IS NOT NULL AND executed_at IS NULL AND failed_at IS NOT NULL)
  ),
  CONSTRAINT uq_category_correction_recommendation_kind UNIQUE (recommendation_event_id, kind)
);

-- Upgrade safety: an earlier development revision required target_category even
-- while recreate was still requested. Replace only that legacy definition;
-- idempotent reruns leave the already-correct constraint untouched.
DO $$
DECLARE
  constraint_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO constraint_definition
    FROM pg_constraint
   WHERE conname = 'category_correction_operations_target_valid'
     AND conrelid = 'category_correction_operations'::regclass;

  IF constraint_definition IS NULL OR position('requested' in constraint_definition) = 0 THEN
    ALTER TABLE category_correction_operations
      DROP CONSTRAINT IF EXISTS category_correction_operations_target_valid;
    ALTER TABLE category_correction_operations
      ADD CONSTRAINT category_correction_operations_target_valid CHECK (
        (kind = 'delist' AND target_category IS NULL AND paid_override_reason IS NULL)
        OR (kind = 'recreate' AND (state = 'requested' OR target_category IS NOT NULL))
      ) NOT VALID;
  END IF;
END
$$;

-- Preserve correction audit history during ordinary event/listing/marketplace
-- retention. Replace only legacy cascading constraints; idempotent reruns do not
-- take repeated table-wide DDL locks. Tenant deletion remains the cascade boundary.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operations_recommendation_event_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    ALTER TABLE category_correction_operations
      DROP CONSTRAINT category_correction_operations_recommendation_event_id_fkey,
      ADD CONSTRAINT category_correction_operations_recommendation_event_id_fkey
        FOREIGN KEY (recommendation_event_id) REFERENCES hermes_events(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operations_listing_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    ALTER TABLE category_correction_operations
      DROP CONSTRAINT category_correction_operations_listing_id_fkey,
      ADD CONSTRAINT category_correction_operations_listing_id_fkey
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operations_marketplace_id_fkey'
       AND confdeltype = 'c'
  ) THEN
    ALTER TABLE category_correction_operations
      DROP CONSTRAINT category_correction_operations_marketplace_id_fkey,
      ADD CONSTRAINT category_correction_operations_marketplace_id_fkey
        FOREIGN KEY (marketplace_id) REFERENCES marketplaces(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_category_correction_operations_workspace
  ON category_correction_operations(workspace_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_category_correction_operations_listing
  ON category_correction_operations(listing_id, requested_at DESC);
