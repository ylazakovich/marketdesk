import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { runMigrationFile } from '../migrate';

const listingConversationsSql = fs.readFileSync(
  path.resolve(process.cwd(), 'src/backend/persistence/migrations/040_listing_conversations.sql'),
  'utf8'
);

type QueryMock = jest.Mock<Promise<{ rows: unknown[] }>, [string, unknown[]?]>;

function clientWithQuery(query: QueryMock): PoolClient {
  return { query } as unknown as PoolClient;
}

function duplicateColumnError(): Error & { code: string } {
  return Object.assign(new Error('column "conversations" already exists'), { code: '42701' });
}

describe('runMigrationFile', () => {
  it('keeps the fresh-database listing conversations migration path unchanged when the column is absent', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '040_listing_conversations.sql',
        listingConversationsSql
      )
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(listingConversationsSql);
  });

  it('treats replay of the exact published conversations migration as applied only when listings.conversations already exists', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockRejectedValueOnce(duplicateColumnError())
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '040_listing_conversations.sql',
        listingConversationsSql
      )
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual([listingConversationsSql]);
    expect(query.mock.calls[1][0]).toContain("attrelid = 'listings'::regclass");
    expect(query.mock.calls[1][0]).toContain("attname = 'conversations'");
  });

  it('allows formatting-only differences when recognizing the published conversations migration shape', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockRejectedValueOnce(duplicateColumnError())
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '040_listing_conversations.sql',
        'ALTER   TABLE listings\n\n  ADD COLUMN conversations INT;'
      )
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not suppress duplicate-column errors from other migrations', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockRejectedValueOnce(duplicateColumnError());

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '999_unrelated.sql',
        'ALTER TABLE listings ADD COLUMN conversations INT;'
      )
    ).rejects.toThrow('column "conversations" already exists');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed when duplicate-column replay has the wrong migration shape', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockRejectedValueOnce(duplicateColumnError());

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '040_listing_conversations.sql',
        'ALTER TABLE listings ADD COLUMN conversations BIGINT;'
      )
    ).rejects.toThrow(/unexpected shape/);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails closed when duplicate-column replay cannot confirm the existing conversations column', async () => {
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
      .mockRejectedValueOnce(duplicateColumnError())
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const originalError = duplicateColumnError();
    query.mockReset()
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    await expect(
      runMigrationFile(
        clientWithQuery(query),
        '040_listing_conversations.sql',
        listingConversationsSql
      )
    ).rejects.toThrow(/listings\.conversations is not present/);

    await expect(
      runMigrationFile(
        clientWithQuery(
          jest
            .fn<Promise<{ rows: unknown[] }>, [string, unknown[]?]>()
            .mockRejectedValueOnce(originalError)
            .mockResolvedValueOnce({ rows: [{ exists: false }] })
        ),
        '040_listing_conversations.sql',
        listingConversationsSql
      )
    ).rejects.toMatchObject({ cause: originalError });

    expect(query).toHaveBeenCalledTimes(2);
  });
});
