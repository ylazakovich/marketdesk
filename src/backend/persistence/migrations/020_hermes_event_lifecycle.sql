-- Migration 020: canonical Hermes event lifecycle.
-- Existing rows are never rewritten. Deployment fails if an unknown legacy value
-- exists so operators can reconcile it explicitly before adding the constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hermes_events
    WHERE status NOT IN (
      'pending_decision',
      'pending_review',
      'applying',
      'applied',
      'dismissed',
      'failed',
      'reverting',
      'reverted'
    )
  ) THEN
    RAISE EXCEPTION 'hermes_events contains status values outside the canonical lifecycle';
  END IF;
END
$$;

ALTER TABLE hermes_events
  DROP CONSTRAINT IF EXISTS hermes_events_status_check;

ALTER TABLE hermes_events
  ADD CONSTRAINT hermes_events_status_check
  CHECK (status IN (
    'pending_decision',
    'pending_review',
    'applying',
    'applied',
    'dismissed',
    'failed',
    'reverting',
    'reverted'
  ));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hermes_events
    WHERE (status IN ('applied', 'dismissed', 'failed', 'reverted')) <> (resolved_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'hermes_events status/resolved_at lifecycle invariant is violated';
  END IF;
END
$$;

ALTER TABLE hermes_events
  DROP CONSTRAINT IF EXISTS hermes_events_resolution_check;

ALTER TABLE hermes_events
  ADD CONSTRAINT hermes_events_resolution_check
  CHECK (
    (status IN ('applied', 'dismissed', 'failed', 'reverted')) = (resolved_at IS NOT NULL)
  );
