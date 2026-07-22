-- Migration 034: install a restart-safe batched backfill procedure.
-- The CALL is isolated in migration 035 so transaction control is legal.

CREATE OR REPLACE PROCEDURE marketdesk_backfill_analytics_event_identity(batch_size INTEGER DEFAULT 1000)
LANGUAGE plpgsql
AS $$
DECLARE
  updated_rows INTEGER;
BEGIN
  LOOP
    WITH batch AS (
      SELECT e.ctid, l.marketplace_id
      FROM analytics_events e
      LEFT JOIN listings l ON l.id = e.listing_id
      WHERE e.quantity IS NULL
         OR (e.marketplace_id IS NULL AND l.marketplace_id IS NOT NULL)
      ORDER BY e.occurred_at, e.id
      LIMIT batch_size
      FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE analytics_events e
    SET marketplace_id = COALESCE(e.marketplace_id, batch.marketplace_id),
        quantity = COALESCE(e.quantity, 1)
    FROM batch
    WHERE e.ctid = batch.ctid;

    GET DIAGNOSTICS updated_rows = ROW_COUNT;
    EXIT WHEN updated_rows = 0;
    COMMIT;
  END LOOP;
END;
$$;
