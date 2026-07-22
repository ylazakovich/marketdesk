-- Migration 036: validate constraints after the batched data prerequisites.
-- PostgreSQL can reuse the validated CHECK when promoting quantity to NOT NULL,
-- avoiding a second full-table validation scan.

ALTER TABLE analytics_events
  VALIDATE CONSTRAINT analytics_events_marketplace_id_fkey;
ALTER TABLE analytics_events
  VALIDATE CONSTRAINT analytics_events_quantity_not_null;
ALTER TABLE analytics_events
  ALTER COLUMN quantity SET NOT NULL;
ALTER TABLE analytics_events
  DROP CONSTRAINT analytics_events_quantity_not_null;

DROP PROCEDURE IF EXISTS marketdesk_backfill_analytics_event_identity(INTEGER);
