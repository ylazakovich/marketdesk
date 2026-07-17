DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_category_provenance_shape'
      AND conrelid = 'products'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE products
      VALIDATE CONSTRAINT products_category_provenance_shape;
  END IF;
END
$$;
