import type { MarketplaceKey } from '../../../shared/types';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type {
  IMarketplaceAdapter,
  ImportedMarketplaceListing,
  ImportDiscoveryOptions,
} from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceHttpClient } from '../../infrastructure/adapters/MarketplaceHttpClient';
import type { MarketplaceAccountRepository } from './MarketplaceOAuthService';
import { Err, Ok, type Result } from '../../domain/shared/Result';
import { GuardrailViolationError, NotFoundError } from '../../domain/shared/DomainError';

export interface ImportMarketplaceAdapterResolver {
  create(key: MarketplaceKey, http?: MarketplaceHttpClient): IMarketplaceAdapter;
}

export interface MarketplaceImportAccessTokenProvider {
  getValidAccessToken(marketplaceId: string): Promise<string>;
}

export interface ImportPreviewInput extends ImportDiscoveryOptions {
  workspaceId: string;
  marketplaceId: string;
}

export type ImportPreviewItemStatus = 'new' | 'already_imported' | 'unsupported';

export interface ImportPreviewItem {
  status: ImportPreviewItemStatus;
  externalListingId: string;
  externalUrl?: string | null;
  title: string;
  remoteStatus: string | null;
  warnings: string[];
  proposed: ImportedMarketplaceListing;
}

export interface ImportPreviewResult {
  marketplaceId: string;
  marketplaceKey: MarketplaceKey;
  readOnly: true;
  totals: Record<ImportPreviewItemStatus, number> & { discovered: number };
  items: ImportPreviewItem[];
}

export class MarketplaceImportService {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly listingRepo: IListingRepository,
    private readonly accountRepo: MarketplaceAccountRepository,
    private readonly adapters: ImportMarketplaceAdapterResolver,
    private readonly accessTokens: MarketplaceImportAccessTokenProvider,
    private readonly authenticatedHttpClient: (accessToken: string) => MarketplaceHttpClient,
  ) {}

  async preview(input: ImportPreviewInput): Promise<Result<ImportPreviewResult>> {
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      input.marketplaceId,
      input.workspaceId,
    );
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${input.marketplaceId}`));
    }
    if (marketplace.key !== 'olx') {
      return Err(new GuardrailViolationError('Import preview currently supports OLX only'));
    }

    const account = await this.accountRepo.findByMarketplaceId(marketplace.id);
    if (!account || account.status !== 'connected') {
      return Err(new GuardrailViolationError('Connected OLX OAuth account is required for import preview'));
    }

    const accessToken = await this.accessTokens.getValidAccessToken(marketplace.id);
    const adapter = this.adapters.create(marketplace.key, this.authenticatedHttpClient(accessToken));
    const remoteListings = await adapter.listOwnedListings({
      pageSize: input.pageSize,
      statuses: input.statuses,
    });
    const existingListings = await this.listingRepo.findByMarketplace(marketplace.id);
    const existingExternalIds = new Set(
      existingListings.flatMap((listing) =>
        listing.marketplaceListingId ? [listing.marketplaceListingId] : [],
      ),
    );

    const items = remoteListings.map((remote): ImportPreviewItem => {
      const warnings: string[] = [];
      if (remote.price === null || remote.price === undefined) warnings.push('missing_price');
      if (!remote.category) warnings.push('missing_category_mapping');
      if (remote.imageUrls.length === 0) warnings.push('missing_photos');

      const status: ImportPreviewItemStatus = existingExternalIds.has(remote.externalListingId)
        ? 'already_imported'
        : remote.status === 'error'
          ? 'unsupported'
          : 'new';
      return {
        status,
        externalListingId: remote.externalListingId,
        externalUrl: remote.externalUrl,
        title: remote.title,
        remoteStatus: remote.remoteStatus ?? null,
        warnings,
        proposed: remote,
      };
    });

    const totals = items.reduce<ImportPreviewResult['totals']>(
      (acc, item) => {
        acc.discovered += 1;
        acc[item.status] += 1;
        return acc;
      },
      { discovered: 0, new: 0, already_imported: 0, unsupported: 0 },
    );

    return Ok({
      marketplaceId: marketplace.id,
      marketplaceKey: marketplace.key,
      readOnly: true,
      totals,
      items,
    });
  }
}
