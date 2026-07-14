-- This file intentionally contains one statement so the migration runner executes
-- CREATE INDEX CONCURRENTLY outside an explicit or implicit multi-statement transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_marketplace_accounts_marketplace
  ON marketplace_accounts(marketplace_id);
