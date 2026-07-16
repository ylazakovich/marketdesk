-- Remove only an invalid remnant left by an interrupted concurrent build.
DO $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('marketdesk:migration:025_hermes_event_idempotency_index.sql'));
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relname = 'uq_hermes_events_workspace_idempotency'
       AND n.nspname = current_schema()
       AND NOT i.indisvalid
  ) THEN
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), 'uq_hermes_events_workspace_idempotency');
  END IF;
END
$$;
