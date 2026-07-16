-- Validate only when needed, in a later migration/transaction than the NOT VALID add.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'olx_publication_operations_mode_valid'
       AND conrelid = 'olx_publication_operations'::regclass
       AND NOT convalidated
  ) THEN
    ALTER TABLE olx_publication_operations
      VALIDATE CONSTRAINT olx_publication_operations_mode_valid;
  END IF;
END
$$;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOREACH constraint_name IN ARRAY ARRAY[
    'category_correction_operations_target_valid',
    'category_correction_operations_recommendation_event_id_fkey',
    'category_correction_operations_listing_id_fkey',
    'category_correction_operations_marketplace_id_fkey'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = constraint_name
         AND conrelid = 'category_correction_operations'::regclass
         AND NOT convalidated
    ) THEN
      EXECUTE format(
        'ALTER TABLE category_correction_operations VALIDATE CONSTRAINT %I',
        constraint_name
      );
    END IF;
  END LOOP;
END
$$;
