ALTER TABLE marketplace_publish_attempts
  ADD COLUMN IF NOT EXISTS remote_status VARCHAR(100),
  ADD COLUMN IF NOT EXISTS remote_image_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
