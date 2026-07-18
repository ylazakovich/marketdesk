-- Allow the existing durable category-correction operation lifecycle to record
-- operator-requested listing delists that are not backed by a Hermes event.
-- This migration changes audit metadata only and performs no provider effects.
ALTER TABLE category_correction_operations
  ALTER COLUMN recommendation_event_id DROP NOT NULL;
