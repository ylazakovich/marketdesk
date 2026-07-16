import fs from 'node:fs';
import path from 'node:path';

describe('OLX category correction migrations', () => {
  const readMigration = (name: string) => fs.readFileSync(
    path.join(process.cwd(), 'src/backend/persistence/migrations', name),
    'utf8',
  );

  it('replaces the legacy non-null recreate target constraint before imports can create unresolved operations', () => {
    const sql = readMigration('026_category_correction_operations.sql');
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
    const createIndex = readMigration('025_hermes_event_idempotency_index.sql');
    const validateConstraint = readMigration('027_validate_olx_publication_mode.sql');

    expect(addConstraint).toContain('NOT VALID');
    expect(addConstraint).not.toContain('VALIDATE CONSTRAINT');
    expect(createIndex).toContain('CREATE UNIQUE INDEX CONCURRENTLY');
    expect(createIndex).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(validateConstraint).toContain('VALIDATE CONSTRAINT olx_publication_operations_mode_valid');
  });

  it('preserves correction audit rows across ordinary event, listing, and marketplace retention', () => {
    const sql = readMigration('026_category_correction_operations.sql');
    const validation = readMigration('027_validate_olx_publication_mode.sql');

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
