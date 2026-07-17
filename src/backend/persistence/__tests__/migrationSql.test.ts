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
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_idx ON private.audit(id);',
    );

    expect(identity).toEqual({ schema: 'private', name: 'audit_idx' });
    expect(quotedIndexIdentity(identity!)).toBe('"private"."audit_idx"');
  });

  it('folds unquoted index and table-schema identifiers to PostgreSQL lowercase', () => {
    const identity = concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY Audit_Idx ON ONLY Private.Audit(id);',
    );

    expect(identity).toEqual({ schema: 'private', name: 'audit_idx' });
    expect(quotedIndexIdentity(identity!)).toBe('"private"."audit_idx"');
  });

  it('supports quoted schema/index identifiers and escaped quotes', () => {
    const identity = concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Mixed/*Case""Index" ON "private--schema".listings(id);',
    );

    expect(identity).toEqual({ schema: 'private--schema', name: 'Mixed/*Case"Index' });
    expect(quotedIndexIdentity(identity!)).toBe('"private--schema"."Mixed/*Case""Index"');
  });

  it('fails closed for PostgreSQL-invalid schema-qualified index names', () => {
    expect(() => concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY private.audit_idx ON private.audit(id);',
    )).toThrow(/cannot be schema-qualified/);
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

  it('ignores DDL-shaped text after a backslash-escaped quote in an E string', () => {
    expect(concurrentIndexIdentity(
      "SELECT E'escaped \\' CREATE INDEX CONCURRENTLY fake_idx ON listings(id)';",
    )).toBeUndefined();
  });

  it('fails closed for unterminated strings', () => {
    expect(() => concurrentIndexIdentity("SELECT E'unterminated\\"))
      .toThrow(/Unterminated SQL escape string/);
  });

  it('fails closed for malformed executable concurrent DDL', () => {
    expect(() => concurrentIndexIdentity(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS ON listings(id);',
    )).toThrow(/Cannot identify/);
  });
});
