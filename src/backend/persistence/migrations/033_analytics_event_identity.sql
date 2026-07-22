-- Migration 033: Preserve marketplace and currency identity on append-only analytics events.
-- Historical filters must remain valid after the source listing is deleted or moved.

ALTER TABLE analytics_events
  ADD COLUMN IF NOT EXISTS marketplace_id UUID REFERENCES marketplaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3);

UPDATE analytics_events e
SET marketplace_id = l.marketplace_id
FROM listings l
WHERE e.listing_id = l.id
  AND e.marketplace_id IS NULL;

-- Legacy rows inherited the original nullable declaration. Preserve its documented
-- default semantics once, then prevent readers from fabricating quantities.
UPDATE analytics_events SET quantity = 1 WHERE quantity IS NULL;
ALTER TABLE analytics_events ALTER COLUMN quantity SET DEFAULT 1;
ALTER TABLE analytics_events ALTER COLUMN quantity SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_workspace_marketplace_date
  ON analytics_events(workspace_id, marketplace_id, occurred_at DESC);
