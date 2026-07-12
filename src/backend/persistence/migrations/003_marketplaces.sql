-- Migration 003: Marketplaces and Marketplace Accounts
-- Authoritative source: ARCHITECTURE.md §7
-- NOTE ON ENCRYPTION: The architecture wrote `credentials JSONB NOT NULL ENCRYPTED`,
--       which is NOT valid PostgreSQL. Encryption is handled at the APPLICATION layer
--       (see CredentialVault, ARCHITECTURE.md §9). The column is a plain JSONB and the
--       app is responsible for encrypting values before insert / decrypting on read.

CREATE TABLE IF NOT EXISTS marketplaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  connected BOOLEAN DEFAULT FALSE,
  sync_mode VARCHAR(50) DEFAULT 'manual',
  last_sync_at TIMESTAMP,
  error_count INT DEFAULT 0,
  capacity INT DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_marketplace UNIQUE (workspace_id, key)
);

CREATE INDEX IF NOT EXISTS idx_marketplaces_workspace ON marketplaces(workspace_id);

CREATE TABLE IF NOT EXISTS marketplace_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  handle VARCHAR(255) NOT NULL,
  -- App-layer encrypted JSONB (see note above); NOT the invalid `ENCRYPTED` keyword.
  credentials JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'connected',
  scopes TEXT[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marketplace_accounts_marketplace ON marketplace_accounts(marketplace_id);
