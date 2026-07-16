import { OlxPublicationQuota } from '../OlxPublicationQuota';

const validProps = {
  id: 'quota-1',
  workspaceId: 'ws-1',
  marketplaceId: 'mp-1',
  marketplaceAccountId: 'account-1',
  subcategoryId: 'electronics',
  cycleStartedAt: new Date('2026-07-01T00:00:00.000Z'),
  cycleEndsAt: new Date('2026-08-01T00:00:00.000Z'),
  publicationLimit: 10,
  consumed: 0,
  source: 'operator' as const,
  confidence: 'verified' as const,
  verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
  staleAt: new Date('2026-07-02T00:00:00.000Z'),
};

describe('OlxPublicationQuota', () => {
  it.each(['cycleStartedAt', 'cycleEndsAt', 'verifiedAt', 'staleAt'] as const)(
    'rejects an invalid %s date',
    (field) => {
      const result = OlxPublicationQuota.create({
        ...validProps,
        [field]: new Date('not-a-date'),
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.message).toBe(`${field} must be a valid date`);
    },
  );

  it('fails closed when evaluating an invalid current time', () => {
    const quota = OlxPublicationQuota.create(validProps);
    expect(quota.isOk()).toBe(true);
    if (quota.isErr()) return;

    expect(quota.value.evaluate(new Date('not-a-date'))).toEqual({
      status: 'stale',
      canPublishForFree: false,
      reason: 'outside_cycle',
    });
  });
});
