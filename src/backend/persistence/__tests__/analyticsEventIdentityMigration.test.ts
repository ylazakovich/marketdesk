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
    expect(concurrentIndexIdentity(index)).toEqual({
      name: 'idx_analytics_workspace_marketplace_date',
    });
    const schema = fs.readFileSync(path.join(persistenceDir, 'schema.sql'), 'utf8');
    expect(schema).toContain('idx_analytics_workspace_marketplace_date');
  });
});
