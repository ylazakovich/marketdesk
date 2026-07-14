import type { Pool } from 'pg';
import { PublishAttemptRepository } from '../PublishAttemptRepository';

const row = {
  operation_id: 'operation-1',
  listing_id: 'listing-1',
  marketplace_key: 'olx',
  status: 'publishing',
  external_listing_id: null,
  published_at: null,
};

describe('PublishAttemptRepository', () => {
  it('atomically creates the first publishing checkpoint', async () => {
    const query = jest.fn(async () => ({ rows: [row], rowCount: 1 }));
    const repository = new PublishAttemptRepository({ query } as unknown as Pool);

    await expect(
      repository.begin('operation-1', 'listing-1', 'olx', new Date(0))
    ).resolves.toMatchObject({
      created: true,
      checkpoint: {
        operationId: 'operation-1',
        listingId: 'listing-1',
        status: 'publishing',
      },
    });
    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT DO NOTHING');
  });

  it('returns the durable winner when another worker already began publishing', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const repository = new PublishAttemptRepository({ query } as unknown as Pool);

    await expect(
      repository.begin('operation-1', 'listing-1', 'olx', new Date(0))
    ).resolves.toMatchObject({
      created: false,
      checkpoint: { operationId: 'operation-1', status: 'publishing' },
    });
  });

  it('stores the provider result before local finalization resumes', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PublishAttemptRepository({ query } as unknown as Pool);
    const publishedAt = new Date('2026-07-14T12:00:00.000Z');

    await repository.markPublished('operation-1', {
      externalListingId: 'olx-123',
      publishedAt,
    });

    expect(String(query.mock.calls[0][0])).toContain("SET status = 'published'");
    expect(query.mock.calls[0][1]).toEqual(['operation-1', 'olx-123', publishedAt]);
  });

  it('releases the listing-level active guard after finalization', async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PublishAttemptRepository({ query } as unknown as Pool);

    await repository.markFinalized('operation-1');

    expect(String(query.mock.calls[0][0])).toContain("SET status = 'finalized'");
    expect(query.mock.calls[0][1]).toEqual(['operation-1']);
  });
});
