-- Persistent, normalized settings contracts. Safe to re-run.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS language VARCHAR(10);
UPDATE workspaces SET language = 'en' WHERE language IS NULL OR btrim(language) = '';
ALTER TABLE workspaces ALTER COLUMN language SET DEFAULT 'en';
ALTER TABLE workspaces ALTER COLUMN language SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspaces_language_valid'
      AND conrelid = 'workspaces'::regclass
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_language_valid CHECK (language IN ('en', 'pl'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_workspace_id ON users(workspace_id, id);

CREATE TABLE IF NOT EXISTS user_preferences (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  theme_mode VARCHAR(20) NOT NULL DEFAULT 'system',
  density VARCHAR(20) NOT NULL DEFAULT 'comfortable',
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT user_preferences_user_workspace_fkey
    FOREIGN KEY (workspace_id, user_id) REFERENCES users(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT user_preferences_theme_mode_valid CHECK (theme_mode IN ('system', 'light', 'dark')),
  CONSTRAINT user_preferences_density_valid CHECK (density IN ('comfortable', 'compact')),
  CONSTRAINT user_preferences_revision_positive CHECK (revision > 0)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_key VARCHAR(60) NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id, event_key),
  CONSTRAINT notification_preferences_user_workspace_fkey
    FOREIGN KEY (workspace_id, user_id) REFERENCES users(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_event_key_valid CHECK (event_key IN (
    'new_sale', 'competitor_price_change', 'listing_needs_attention',
    'sync_error', 'weekly_performance_report'
  )),
  CONSTRAINT notification_preferences_revision_positive CHECK (revision > 0)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user
  ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences(user_id);
