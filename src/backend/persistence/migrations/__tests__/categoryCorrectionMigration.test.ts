import fs from 'node:fs';
import path from 'node:path';

describe('024 category correction migration', () => {
  it('replaces the legacy non-null recreate target constraint before imports can create unresolved operations', () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/backend/persistence/migrations/024_category_correction_operations.sql',
      ),
      'utf8',
    );
    const drop = sql.indexOf(
      'DROP CONSTRAINT IF EXISTS category_correction_operations_target_valid',
    );
    const add = sql.lastIndexOf(
      'ADD CONSTRAINT category_correction_operations_target_valid CHECK',
    );

    expect(drop).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(drop);
    expect(sql.slice(add)).toContain(
      "kind = 'recreate' AND (state = 'requested' OR target_category IS NOT NULL)",
    );
  });
});
