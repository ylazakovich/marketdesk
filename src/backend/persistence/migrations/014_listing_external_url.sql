ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS external_url TEXT;

ALTER TABLE marketplace_publish_attempts
  ADD COLUMN IF NOT EXISTS external_url TEXT;
