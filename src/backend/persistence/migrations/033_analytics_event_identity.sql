-- Migration 033: introduce immutable analytics identity without blocking writes.
-- Validation, batched backfill, NOT NULL promotion and concurrent indexing are
-- deliberately split into later migrations.

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS marketplace_id UUID,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analytics_events_marketplace_id_fkey'
      AND conrelid = 'analytics_events'::regclass
  ) THEN
    ALTER TABLE analytics_events
      ADD CONSTRAINT analytics_events_marketplace_id_fkey
      FOREIGN KEY (marketplace_id)
      REFERENCES marketplaces(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

ALTER TABLE analytics_events ALTER COLUMN quantity SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'analytics_events_quantity_not_null'
      AND conrelid = 'analytics_events'::regclass
  ) THEN
    ALTER TABLE analytics_events
      ADD CONSTRAINT analytics_events_quantity_not_null
      CHECK (quantity IS NOT NULL)
      NOT VALID;
  END IF;
END $$;
