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

  it('supports quoted schema/index identifiers and escaped quotes', () => {
    const identity = concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "private--schema"."Mixed/*Case""Index" ON listings(id);',
    );

    expect(identity).toEqual({ schema: 'private--schema', name: 'Mixed/*Case"Index' });
    expect(quotedIndexIdentity(identity!)).toBe('"private--schema"."Mixed/*Case""Index"');
  });

  it('ignores DDL-shaped text in strings and dollar-quoted bodies', () => {
    expect(concurrentIndexIdentity(`
      SELECT 'CREATE INDEX CONCURRENTLY fake_string ON listings(id)';
      SELECT $$CREATE INDEX CONCURRENTLY fake_dollar ON listings(id)$$;
      DO $body$
      BEGIN
        RAISE NOTICE 'CREATE UNIQUE INDEX CONCURRENTLY fake_body ON listings(id)';
      END
      $body$;
    `)).toBeUndefined();
  });

  it('fails closed for malformed executable concurrent DDL', () => {
    expect(() => concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS ON listings(id);',
    )).toThrow(/Cannot identify/);
  });
});
