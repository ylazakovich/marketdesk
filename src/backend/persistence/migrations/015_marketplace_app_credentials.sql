-- Workspace-scoped marketplace application credentials. These are the OAuth
-- client_id/client_secret pairs created by each seller in the provider console;
-- they are distinct from marketplace_accounts, which store account access tokens
-- after the OAuth callback completes.

CREATE TABLE IF NOT EXISTS marketplace_app_credentials (
  id UUID PRIMARY KEY,
  marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  encrypted_client_secret JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT marketplace_app_credentials_marketplace_unique UNIQUE (marketplace_id),
  CONSTRAINT marketplace_app_credentials_client_id_nonempty CHECK (length(trim(client_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_app_credentials_marketplace
  ON marketplace_app_credentials(marketplace_id);
