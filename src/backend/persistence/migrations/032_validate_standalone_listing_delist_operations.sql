-- Validate separately so migration 031 does not scan the operation table while
-- holding the stronger ADD CONSTRAINT lock.
DO $$
DECLARE
  constraint_validated boolean;
BEGIN
  SELECT convalidated
    INTO constraint_validated
    FROM pg_constraint
   WHERE conrelid = 'category_correction_operations'::regclass
     AND conname = 'category_correction_operation_recommendation_check';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing constraint category_correction_operation_recommendation_check';
  ELSIF NOT constraint_validated THEN
    ALTER TABLE category_correction_operations
      VALIDATE CONSTRAINT category_correction_operation_recommendation_check;
  END IF;
END
$$;