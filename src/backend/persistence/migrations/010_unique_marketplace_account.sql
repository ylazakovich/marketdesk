-- A failed CREATE INDEX CONCURRENTLY can leave an invalid index that
-- IF NOT EXISTS would otherwise skip forever. Remove only that invalid remnant;
-- a valid index is preserved on every idempotent migration run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS index_class
    JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
    WHERE index_class.relname = 'uq_marketplace_accounts_marketplace'
      AND namespace.nspname = current_schema()
      AND NOT index_meta.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX uq_marketplace_accounts_marketplace';
  END IF;
END
$$;
