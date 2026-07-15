-- OLX free-publication quota is intentionally separate from marketplaces.capacity.
-- A quota row belongs to one workspace/account, exact OLX subcategory and cycle.
-- Consumption is monotonic for a cycle; deleting/selling a listing never updates it.
CREATE TABLE IF NOT EXISTS olx_publication_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  subcategory_id VARCHAR(100) NOT NULL,
  cycle_started_at TIMESTAMPTZ NOT NULL,
  cycle_ends_at TIMESTAMPTZ NOT NULL,
  publication_limit INT NOT NULL,
  consumed INT NOT NULL DEFAULT 0,
  source VARCHAR(50) NOT NULL,
  confidence VARCHAR(30) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  stale_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT olx_publication_quotas_subcategory_not_blank CHECK (btrim(subcategory_id) <> ''),
  CONSTRAINT olx_publication_quotas_cycle_valid CHECK (cycle_started_at < cycle_ends_at),
  CONSTRAINT olx_publication_quotas_counts_valid CHECK (publication_limit >= 0 AND consumed >= 0),
  CONSTRAINT olx_publication_quotas_source_valid CHECK (source IN ('operator', 'provider', 'reconciled')),
  CONSTRAINT olx_publication_quotas_confidence_valid CHECK (confidence IN ('verified', 'estimated')),
  CONSTRAINT olx_publication_quotas_staleness_valid CHECK (verified_at < stale_at),
  CONSTRAINT uq_olx_publication_quota_cycle
    UNIQUE (workspace_id, marketplace_account_id, subcategory_id, cycle_started_at)
);

CREATE INDEX IF NOT EXISTS idx_olx_publication_quotas_lookup
  ON olx_publication_quotas
  (workspace_id, marketplace_id, marketplace_account_id, subcategory_id, cycle_started_at DESC);

-- Durable per-operation decision ledger. operation_id deduplicates retries while the
-- quota row lock serializes independently generated operations competing for the
-- final free unit.
CREATE TABLE IF NOT EXISTS olx_publication_operations (
  operation_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  quota_id UUID REFERENCES olx_publication_quotas(id) ON DELETE SET NULL,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  subcategory_id VARCHAR(100) NOT NULL,
  mode VARCHAR(20) NOT NULL,
  decision VARCHAR(20) NOT NULL,
  quota_status VARCHAR(30) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  consumed_unit BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  actor_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT olx_publication_operations_mode_valid CHECK (mode IN ('publish', 'relist')),
  CONSTRAINT olx_publication_operations_decision_valid CHECK (decision IN ('allow', 'block', 'override')),
  CONSTRAINT olx_publication_operations_status_valid
    CHECK (quota_status IN ('available', 'exhausted', 'stale', 'unverified', 'unknown')),
  CONSTRAINT olx_publication_operations_override_valid CHECK (
    (decision = 'override' AND override_reason IS NOT NULL AND btrim(override_reason) <> '')
    OR (decision <> 'override' AND override_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_olx_publication_operations_listing
  ON olx_publication_operations(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_olx_publication_operations_quota
  ON olx_publication_operations(quota_id, created_at DESC);
