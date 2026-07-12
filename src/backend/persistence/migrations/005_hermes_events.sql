-- Migration 005: Hermes Events (the core AI event log)
-- Authoritative source: ARCHITECTURE.md §7
-- severity          : info | success | warning | critical
-- status            : pending_review | applied | dismissed
-- autonomy_decision : auto_apply | pending_review
-- proposed_change   : app-layer typed JSONB payload (e.g. {field:'price', from:100, to:90})

CREATE TABLE IF NOT EXISTS hermes_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  detail TEXT,
  proposed_change JSONB,
  autonomy_decision VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hermes_events_workspace ON hermes_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_hermes_events_product ON hermes_events(product_id);
CREATE INDEX IF NOT EXISTS idx_hermes_events_status ON hermes_events(status);
CREATE INDEX IF NOT EXISTS idx_hermes_events_created ON hermes_events(created_at);
