import fs from 'fs';
import path from 'path';
import { concurrentIndexIdentity } from '../migrationSql';

const persistenceDir = path.join(process.cwd(), 'src/backend/persistence');
const migrationsDir = path.join(persistenceDir, 'migrations');
const read = (name: string) => fs.readFileSync(path.join(migrationsDir, name), 'utf8');

describe('analytics event identity migrations', () => {
  it('stages constraints, batched backfill, validation and online indexing', () => {
    const prepare = read('033_analytics_event_identity.sql');
    const procedure = read('034_prepare_analytics_event_backfill.sql');
    const run = read('035_run_analytics_event_backfill.sql');
    const validate = read('036_validate_analytics_event_identity.sql');
    const index = read('037_index_analytics_event_identity.sql');
    const seedViews = read('038_seed_views_from_listings.sql');
    const reconcileSignedViews = read('039_reconcile_signed_view_totals.sql');

    expect(prepare).toMatch(/FOREIGN KEY \(marketplace_id\)[\s\S]*NOT VALID/);
    expect(prepare).toMatch(/CHECK \(quantity IS NOT NULL\)[\s\S]*NOT VALID/);
    expect(prepare).not.toMatch(/SET NOT NULL/);
    expect(procedure).toMatch(/LIMIT batch_size/);
    expect(procedure).toMatch(/SKIP LOCKED/);
    expect(procedure).toMatch(/COMMIT;/);
    expect(run).toMatch(/^\s*CALL marketdesk_backfill_analytics_event_identity\(1000\);\s*$/m);
    expect(validate).toMatch(/VALIDATE CONSTRAINT analytics_events_marketplace_id_fkey/);
    expect(validate).toMatch(/VALIDATE CONSTRAINT analytics_events_quantity_not_null/);
    expect(validate).toMatch(/ALTER COLUMN quantity SET NOT NULL/);
    expect(seedViews).toMatch(/INSERT INTO analytics_events/);
    expect(seedViews).toMatch(/JOIN products p ON p.id = l.product_id/);
    expect(seedViews).toMatch(/SUM\(GREATEST\(e\.quantity, 0\)\) FILTER \(WHERE e\.event_type = 'view'\)/);
    expect(seedViews).toMatch(/GREATEST\(COALESCE\(l\.views, 0\) - existing_views\.quantity, 0\)/);
    expect(seedViews).toMatch(/COALESCE\(l\.last_sync_at, l\.updated_at, l\.published_at, l\.created_at, CURRENT_TIMESTAMP\)/);
    expect(seedViews).toMatch(/WHERE quantity > 0/);
    expect(seedViews).not.toMatch(/event_type[^\n]*'sale'/);
    expect(seedViews).not.toMatch(/event_type[^\n]*'message'/);
    expect(reconcileSignedViews).toMatch(/SUM\(e\.quantity\) FILTER \(WHERE e\.event_type = 'view'\)/);
    expect(reconcileSignedViews).toMatch(/GREATEST\(COALESCE\(l\.views, 0\) - signed_views\.quantity, 0\) AS gap/);
    expect(reconcileSignedViews).toMatch(/generate_series\(/);
    expect(reconcileSignedViews).toMatch(/WHERE corrections\.gap > 0/);
    expect(reconcileSignedViews).not.toMatch(/SUM\(GREATEST\(e\.quantity, 0\)\)/);
    expect(reconcileSignedViews).not.toMatch(/event_type[^\n]*'sale'/);
    expect(reconcileSignedViews).not.toMatch(/event_type[^\n]*'message'/);
    expect(concurrentIndexIdentity(index)).toEqual({
      name: 'idx_analytics_workspace_marketplace_date',
    });
    const schema = fs.readFileSync(path.join(persistenceDir, 'schema.sql'), 'utf8');
    expect(schema).toContain('idx_analytics_workspace_marketplace_date');
  });
});
