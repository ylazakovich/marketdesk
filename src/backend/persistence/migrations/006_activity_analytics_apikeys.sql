-- Migration 006: Activity Log (audit trail), Analytics Events, API Keys
-- Authoritative source: ARCHITECTURE.md §7 (+ ARCHITECTURE_AMENDMENTS FIX #7 cost_at_sale)

-- Activity Log (Audit Trail)
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  actor_type VARCHAR(50) NOT NULL, -- 'user' | 'hermes'
  actor_id VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_workspace_date ON activity_log(workspace_id, created_at DESC);

-- Analytics Events (append-only)
-- cost_at_sale is a COGS snapshot for correct profit calc (AMENDMENTS FIX #7).
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL, -- 'view' | 'message' | 'sale'
  quantity INT NOT NULL DEFAULT 1,
  amount DECIMAL(10, 2),
  cost_at_sale DECIMAL(10, 2),
  occurred_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_workspace_type ON analytics_events(workspace_id, event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_listing ON analytics_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_analytics_occurred ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_workspace_date ON analytics_events(workspace_id, occurred_at DESC);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
