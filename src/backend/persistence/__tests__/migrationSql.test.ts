import { concurrentIndexIdentity, quotedIndexIdentity } from '../migrationSql';

describe('concurrent migration SQL parsing', () => {
  it('ignores CREATE INDEX CONCURRENTLY text inside line and block comments', () => {
    const sql = `
      -- CREATE INDEX CONCURRENTLY outside a transaction
      /* CREATE UNIQUE INDEX CONCURRENTLY fake_index ON fake_table(id); */
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS real_index
        ON listings(marketplace_id, marketplace_listing_id);
    `;

    expect(concurrentIndexIdentity(sql)).toEqual({ name: 'real_index' });
  });

  it('returns undefined when concurrent DDL appears only in comments', () => {
    expect(concurrentIndexIdentity(`
      -- CREATE INDEX CONCURRENTLY can leave an invalid remnant
      DO $$ BEGIN PERFORM 1; END $$;
    `)).toBeUndefined();
  });

  it('supports explicit unquoted schemas and quotes the recovery identifier', () => {
    const identity = concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS private.audit_idx ON private.audit(id);',
    );

    expect(identity).toEqual({ schema: 'private', name: 'audit_idx' });
    expect(quotedIndexIdentity(identity!)).toBe('"private"."audit_idx"');
  });

  it('fails closed for quoted names that the recovery parser does not support', () => {
    expect(() => concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "MixedCase" ON listings(id);',
    )).toThrow(/Cannot identify/);
  });
});
