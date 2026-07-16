ALTER TABLE hermes_events
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(500);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hermes_events_workspace_idempotency
  ON hermes_events(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;