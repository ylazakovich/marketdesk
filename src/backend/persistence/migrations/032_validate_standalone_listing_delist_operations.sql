-- Validate separately so migration 031 does not scan the operation table while
-- holding the stronger ADD CONSTRAINT lock.
ALTER TABLE category_correction_operations
  VALIDATE CONSTRAINT category_correction_operation_recommendation_check;