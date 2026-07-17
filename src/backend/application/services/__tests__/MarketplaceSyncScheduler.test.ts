import { Marketplace } from '../../../domain/entities/Marketplace';
import { MarketplaceSyncScheduler } from '../MarketplaceSyncScheduler';
import type { SyncMarketplaceJob } from '../../ports/IJobQueue';

function unwrapMarketplace(result: ReturnType<typeof Marketplace.create>): Marketplace {
  if (result.isErr()) throw result.error;
  return result.value;
}

function marketplace(overrides: Partial<Parameters<typeof Marketplace.create>[0]> = {}): Marketplace {
  return unwrapMarketplace(
    Marketplace.create({
      id: 'm-1',
      workspaceId: 'w-1',
      key: 'olx',
      name: 'OLX',
      connected: true,
      syncMode: 'manual',
      ...overrides,
    }),
  );
}

function schedulerHarness() {
  const scheduled: Array<{ data: SyncMarketplaceJob; options: { jobId: string; everyMs: number } }> = [];
  const removed: string[] = [];
  const scheduler = new MarketplaceSyncScheduler({
    scheduleRepeat: jest.fn(
      async (data: SyncMarketplaceJob, options: { jobId: string; everyMs: number }) => {
        scheduled.push({ data, options });
      },
    ),
    removeRepeat: jest.fn(async (jobId: string) => {
      removed.push(jobId);
    }),
  });
  return { scheduler, scheduled, removed };
}

describe('MarketplaceSyncScheduler', () => {
  it('documents manual mode as explicit-action only and removes schedules', async () => {
    const { scheduler, scheduled, removed } = schedulerHarness();
    const m = marketplace({ syncMode: 'manual' });

    const contract = await scheduler.reconcile(m);

    expect(contract).toMatchObject({ mode: 'manual', scheduled: false });
    expect(scheduled).toEqual([]);
    expect(removed).toEqual(['sync-marketplace:m-1:hourly']);
  });

  it('creates one deterministic hourly repeatable job for connected marketplaces', async () => {
    const { scheduler, scheduled, removed } = schedulerHarness();
    const m = marketplace({ syncMode: 'hourly' });

    const first = await scheduler.reconcile(m);
    const second = await scheduler.reconcile(m);

    expect(first).toMatchObject({
      mode: 'hourly',
      scheduled: true,
      jobId: 'sync-marketplace:m-1:hourly',
      everyMs: 3_600_000,
    });
    expect(second.jobId).toBe(first.jobId);
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toEqual({
      data: {
        marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [], trigger: 'scheduled',
      },
      options: { jobId: 'sync-marketplace:m-1:hourly', everyMs: 3_600_000 },
    });
    expect(removed).toEqual([]);
  });

  it('removes schedules for disconnected marketplaces even when mode is hourly', async () => {
    const { scheduler, scheduled, removed } = schedulerHarness();
    const m = marketplace({ syncMode: 'hourly', connected: false });

    const contract = await scheduler.reconcile(m);

    expect(contract).toMatchObject({ mode: 'hourly', scheduled: false });
    expect(scheduled).toEqual([]);
    expect(removed).toEqual(['sync-marketplace:m-1:hourly']);
  });

  it('rejects realtime mode until verified provider webhooks exist', async () => {
    const { scheduler, scheduled, removed } = schedulerHarness();
    const m = marketplace({ syncMode: 'realtime' });

    await expect(scheduler.reconcile(m)).rejects.toThrow('Real-time OLX sync is disabled');
    expect(scheduled).toEqual([]);
    expect(removed).toEqual(['sync-marketplace:m-1:hourly']);
  });

  it('unschedules by deterministic marketplace job id', async () => {
    const { scheduler, removed } = schedulerHarness();

    await scheduler.unschedule('m-2');

    expect(removed).toEqual(['sync-marketplace:m-2:hourly']);
  });
});
