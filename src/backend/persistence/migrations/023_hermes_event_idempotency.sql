ALTER TABLE hermes_events
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(500);
