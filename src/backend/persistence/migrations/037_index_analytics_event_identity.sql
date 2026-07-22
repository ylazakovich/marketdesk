-- Migration 037: standalone online index creation.
-- The migration runner detects this single concurrent DDL statement and executes
-- it outside a transaction while retaining the suite-wide advisory lock.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_workspace_marketplace_date
  ON analytics_events(workspace_id, marketplace_id, occurred_at DESC);
