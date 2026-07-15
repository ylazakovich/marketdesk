// Use case: enqueue a marketplace sync job. Collects the external listing ids
// currently tracked for the marketplace and enqueues a sync job; the job (Group 6)
// pulls fresh stats/status via the appropriate adapter.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IJobQueue, SyncMarketplaceJob } from '../ports/IJobQueue';
import type { SyncMarketplaceDTO } from '../dto/HermesDTO';

export interface SyncMarketplaceEnqueueResult {
  marketplaceId: string;
  enqueued: boolean;
  externalListingCount: number;
}

export class SyncMarketplaceUseCase {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly listingRepo: IListingRepository,
    private readonly syncQueue: IJobQueue<SyncMarketplaceJob>,
  ) {}

  async execute(
    input: SyncMarketplaceDTO,
  ): Promise<Result<SyncMarketplaceEnqueueResult>> {
    const marketplace = input.workspaceId
      ? await this.marketplaceRepo.findByIdForWorkspace(input.marketplaceId, input.workspaceId)
      : await this.marketplaceRepo.findById(input.marketplaceId);
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${input.marketplaceId}`));
    }

    const listings = await this.listingRepo.findByMarketplace(marketplace.id);
    const externalListingIds = listings
      .map((l) => l.marketplaceListingId)
      .filter((id): id is string => id !== null && id.length > 0);

    await this.syncQueue.enqueue({
      marketplaceKey: marketplace.key,
      marketplaceId: marketplace.id,
      externalListingIds,
    });

    return Ok({
      marketplaceId: marketplace.id,
      enqueued: true,
      externalListingCount: externalListingIds.length,
    });
  }
}
