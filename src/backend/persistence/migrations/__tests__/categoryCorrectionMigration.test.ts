import fs from 'node:fs';
import path from 'node:path';

describe('OLX category correction migrations', () => {
  const readMigration = (name: string) => fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/migrations', name),
    'utf8',
  );

  it('replaces the legacy non-null recreate target constraint before imports can create unresolved operations', () => {
    const sql = readMigration('025_category_correction_operations.sql');
    const drop = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS category_correction_operations_target_valid',
    );
    const add = sql.lastIndexOf(
      'ADD CONSTRAINT category_correction_operations_target_valid CHECK',
    );

    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    expect(sql.slice(0, drop)).toContain("position('requested' in constraint_definition) = 0");
    expect(sql.slice(add)).toContain(
      "kind = 'recreate' AND (state = 'requested' OR target_category IS NOT NULL)",
    );
  });

  it('keeps index creation standalone and validates the quota constraint in a later migration', () => {
    const addConstraint = readMigration('022_listing_marketplace_category.sql');
    const createIndex = readMigration('024_hermes_event_idempotency_index.sql');
    const validateConstraint = readMigration('026_validate_olx_publication_mode.sql');

    expect(addConstraint).toContain('NOT VALID');
    expect(addConstraint).not.toContain('VALIDATE CONSTRAINT');
    expect(createIndex).toContain('CREATE UNIQUE INDEX CONCURRENTLY');
    expect(createIndex).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(validateConstraint).toContain('VALIDATE CONSTRAINT olx_publication_operations_mode_valid');
  });

  it('serializes the full lexical run and repairs invalid concurrent-index remnants under the same session lock', () => {
    const runner = fs.readFileSync(
      path.join(process.cwd(), 'src/backend/persistence/migrate.ts'),
      'utf8',
    );
    const lock = runner.indexOf("pg_advisory_lock(hashtext($1))");
    const loop = runner.indexOf('for (const file of files)');
    const invalidInspection = runner.indexOf('index.indisvalid');
    const invalidDrop = runner.indexOf('DROP INDEX CONCURRENTLY IF EXISTS');
    const unlock = runner.indexOf('pg_advisory_unlock(hashtext($1))');

    expect(lock).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(lock);
    expect(invalidInspection).toBeGreaterThan(loop);
    expect(invalidDrop).toBeGreaterThan(invalidInspection);
    expect(unlock).toBeGreaterThan(invalidDrop);
    expect(runner).toContain('await client.query(sql)');
    expect(runner).not.toContain('await pool.query(sql)');
  });

  it('persists product category provenance with a constrained JSONB shape in migration and schema snapshot', () => {
    const migration = readMigration('027_product_category_provenance.sql');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'src/backend/persistence/schema.sql'),
      'utf8',
    );

    for (const sql of [migration, schema]) {
      expect(sql).toContain('category_provenance JSONB');
      expect(sql).toContain('products_category_provenance_shape');
      expect(sql).toContain("category_provenance->>'status' IN ('synced', 'conflict')");
      expect(sql).toContain('COALESCE(');
    }
    expect(migration).toContain('pg_get_constraintdef(oid)');
    expect(migration).toContain("POSITION('COALESCE' IN UPPER(constraint_definition)) = 0");
    expect(migration).toContain('DROP CONSTRAINT products_category_provenance_shape');
    expect(migration).toContain('ADD CONSTRAINT products_category_provenance_shape');
    expect(migration).toContain('NOT VALID');

    const validation = readMigration('028_validate_product_category_provenance.sql');
    expect(validation).toContain('AND NOT convalidated');
    expect(validation).toContain('VALIDATE CONSTRAINT products_category_provenance_shape');
  });

  it('preserves correction audit rows across ordinary event, listing, and marketplace retention', () => {
    const sql = readMigration('025_category_correction_operations.sql');
    const validation = readMigration('026_validate_olx_publication_mode.sql');

    expect(sql).toContain('recommendation_event_id UUID NOT NULL REFERENCES hermes_events(id) ON DELETE RESTRICT');
    expect(sql).toContain('listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT');
    expect(sql).toContain('marketplace_id UUID NOT NULL REFERENCES marketplaces(id) ON DELETE RESTRICT');
    expect(sql).toContain('workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE');
    expect(sql.match(/ON DELETE RESTRICT NOT VALID/g)).toHaveLength(3);
    expect(validation).toContain('category_correction_operations_recommendation_event_id_fkey');
    expect(validation).toContain('category_correction_operations_target_valid');
    expect(validation).toContain('category_correction_operations_listing_id_fkey');
    expect(validation).toContain('category_correction_operations_marketplace_id_fkey');
  });
});
