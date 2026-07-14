-- A failed CREATE INDEX CONCURRENTLY can leave an invalid index that
-- IF NOT EXISTS would otherwise skip forever. Remove only that invalid remnant;
-- a valid index is preserved on every idempotent migration run.
DO $$
BEGIN
  -- Multiple instances may run the idempotent migration set concurrently.
  PERFORM pg_advisory_xact_lock(
    hashtext('marketdesk:migration:011_create_unique_marketplace_account_index.sql')
  );
  IF EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
    WHERE index_class.relname = 'uq_marketplace_accounts_marketplace'
      AND namespace.nspname = current_schema()
      AND NOT index_meta.indisvalid
  ) THEN
    EXECUTE format(
      'DROP INDEX IF EXISTS %I.%I',
      current_schema(),
      'uq_marketplace_accounts_marketplace'
    );
  END IF;
END
$$;
