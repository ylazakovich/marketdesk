ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category_provenance JSONB;

DO $$
DECLARE
  constraint_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO constraint_definition
  FROM pg_constraint
  WHERE conname = 'products_category_provenance_shape'
    AND conrelid = 'products'::regclass;

  -- Replace the weaker definition shipped by an earlier execution of migration 027.
  IF constraint_definition IS NOT NULL
    AND POSITION('COALESCE' IN UPPER(constraint_definition)) = 0 THEN
    ALTER TABLE products
      DROP CONSTRAINT products_category_provenance_shape;
    constraint_definition := NULL;
  END IF;

  IF constraint_definition IS NULL THEN
    ALTER TABLE products
      ADD CONSTRAINT products_category_provenance_shape
      CHECK (
        category_provenance IS NULL
        OR (
          jsonb_typeof(category_provenance) = 'object'
          AND COALESCE(
            category_provenance->>'status' IN ('synced', 'conflict'),
            FALSE
          )
        )
      ) NOT VALID;
  END IF;
END
$$;

COMMENT ON COLUMN products.category_provenance IS
  'Trusted marketplace category source or an unresolved multi-listing category conflict';
