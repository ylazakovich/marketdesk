-- Intentionally one statement: the runner executes concurrent DDL outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_hermes_events_workspace_idempotency
  ON hermes_events(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
