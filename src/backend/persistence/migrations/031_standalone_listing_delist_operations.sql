-- Allow the existing durable category-correction operation lifecycle to record
-- operator-requested listing delists that are not backed by a Hermes event.
-- This migration changes audit metadata only and performs no provider effects.
ALTER TABLE category_correction_operations
  ALTER COLUMN recommendation_event_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'category_correction_operations'::regclass
       AND conname = 'category_correction_operation_recommendation_check'
  ) THEN
    ALTER TABLE category_correction_operations
      ADD CONSTRAINT category_correction_operation_recommendation_check
      CHECK (kind = 'delist' OR recommendation_event_id IS NOT NULL)
      NOT VALID;
  END IF;
END
$$;
