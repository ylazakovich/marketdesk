import type { Marketplace } from '../../domain/entities/Marketplace';
import type { SyncMarketplaceJob } from '../ports/IJobQueue';
import { InvalidStateError } from '../../domain/shared/DomainError';

const HOURLY_SYNC_EVERY_MS = 60 * 60 * 1000;

export interface RepeatableSyncQueue {
  scheduleRepeat(data: SyncMarketplaceJob, options: { jobId: string; everyMs: number }): Promise<void>;
  removeRepeat(jobId: string): Promise<void>;
}

export interface MarketplaceSyncScheduleContract {
  mode: 'manual' | 'hourly' | 'realtime';
  scheduled: boolean;
  reason: string;
  jobId?: string;
  everyMs?: number;
}

export class MarketplaceSyncScheduler {
  constructor(private readonly queue: RepeatableSyncQueue) {}

  static jobId(marketplaceId: string): string {
    return `sync-marketplace:${marketplaceId}:hourly`;
  }

  contract(marketplace: Marketplace): MarketplaceSyncScheduleContract {
    if (marketplace.syncMode === 'manual') {
      return {
        mode: 'manual',
        scheduled: false,
        reason: 'Manual sync runs only from an explicit user or system action.',
      };
    }

    if (marketplace.syncMode === 'realtime') {
      return {
        mode: 'realtime',
        scheduled: false,
        reason: 'Real-time OLX sync is disabled until verified OLX webhooks are available.',
      };
    }

    return {
      mode: 'hourly',
      scheduled: marketplace.isConnected(),
      reason: marketplace.isConnected()
        ? 'Hourly sync uses one deterministic repeatable job per connected marketplace.'
        : 'Disconnected marketplaces do not run scheduled sync.',
      jobId: MarketplaceSyncScheduler.jobId(marketplace.id),
      everyMs: HOURLY_SYNC_EVERY_MS,
    };
  }

  async reconcile(marketplace: Marketplace): Promise<MarketplaceSyncScheduleContract> {
    const jobId = MarketplaceSyncScheduler.jobId(marketplace.id);

    if (marketplace.syncMode === 'realtime') {
      await this.queue.removeRepeat(jobId);
      throw new InvalidStateError(
        'Real-time OLX sync is disabled until verified OLX webhooks are available',
      );
    }

    if (!marketplace.isConnected() || marketplace.syncMode === 'manual') {
      await this.queue.removeRepeat(jobId);
      return this.contract(marketplace);
    }

    await this.queue.scheduleRepeat(
      {
        marketplaceKey: marketplace.key,
        marketplaceId: marketplace.id,
        externalListingIds: [],
        trigger: 'scheduled',
      },
      { jobId, everyMs: HOURLY_SYNC_EVERY_MS },
    );
    return this.contract(marketplace);
  }

  async unschedule(marketplaceId: string): Promise<void> {
    await this.queue.removeRepeat(MarketplaceSyncScheduler.jobId(marketplaceId));
  }
}
