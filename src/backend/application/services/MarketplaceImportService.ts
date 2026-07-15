import { randomUUID } from 'crypto';
import type { MarketplaceKey, ProductCondition } from '../../../shared/types';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import { Money } from '../../domain/valueObjects/Money';
import type {
  IMarketplaceAdapter,
  ImportedMarketplaceListing,
  ImportDiscoveryOptions,
} from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceHttpClient } from '../../infrastructure/adapters/MarketplaceHttpClient';
import type { MarketplaceAccountRepository } from './MarketplaceOAuthService';
import type { IdGenerator } from '../ports/IdGenerator';
import { Err, Ok, type Result } from '../../domain/shared/Result';
import { GuardrailViolationError, NotFoundError, ValidationError } from '../../domain/shared/DomainError';

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

export interface ImportApplyInput extends ImportPreviewInput {
  externalListingIds?: string[];
  actorId?: string;
}

export type ImportPreviewItemStatus =
  | 'new'
  | 'already_imported'
  | 'changed'
  | 'unsupported'
  | 'failed';

export interface ImportPreviewItem {
  status: ImportPreviewItemStatus;
  externalListingId: string;
  externalUrl?: string | null;
  title: string;
  remoteStatus: string | null;
  warnings: string[];
  proposed: ImportedMarketplaceListing;
  existingListingId?: string | null;
  proposedChanges?: string[];
}

export interface ImportPreviewResult {
  marketplaceId: string;
  marketplaceKey: MarketplaceKey;
  readOnly: true;
  totals: Record<ImportPreviewItemStatus, number> & { discovered: number };
  items: ImportPreviewItem[];
}

export interface ImportApplyResult {
  marketplaceId: string;
  marketplaceKey: MarketplaceKey;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  results: Array<{
    externalListingId: string;
    status: 'imported' | 'updated' | 'skipped' | 'failed';
    productId?: string;
    listingId?: string;
    reason?: string;
  }>;
}

const EMPTY_TOTALS: ImportPreviewResult['totals'] = {
  discovered: 0,
  new: 0,
  already_imported: 0,
  changed: 0,
  unsupported: 0,
  failed: 0,
};

const IMPORT_TAG = 'imported:olx';
const ADOPTED_TAG = 'adopted-existing-advert';
const UNKNOWN_COST_TAG = 'cost-price:unknown';
const UNKNOWN_CONDITION_TAG = 'condition:requires-confirmation';

export class MarketplaceImportService {
  constructor(
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly accountRepo: MarketplaceAccountRepository,
    private readonly adapters: ImportMarketplaceAdapterResolver,
    private readonly accessTokens: MarketplaceImportAccessTokenProvider,
    private readonly authenticatedHttpClient: (accessToken: string) => MarketplaceHttpClient,
    private readonly activityLog?: IActivityLogRepository,
    private readonly idGenerator: IdGenerator = randomUUID,
  ) {}

  async preview(input: ImportPreviewInput): Promise<Result<ImportPreviewResult>> {
    const context = await this.discover(input);
    if (context.isErr()) return context;
    return Ok(this.buildPreview(context.value.marketplace.id, context.value.marketplace.key, context.value.remoteListings, context.value.existingListings, []));
  }

  async import(input: ImportApplyInput): Promise<Result<ImportApplyResult>> {
    const context = await this.discover(input);
    if (context.isErr()) return context;

    const selected = new Set(input.externalListingIds ?? []);
    const preview = this.buildPreview(
      context.value.marketplace.id,
      context.value.marketplace.key,
      context.value.remoteListings,
      context.value.existingListings,
      [],
    );
    const items = preview.items.filter((item) => selected.size === 0 || selected.has(item.externalListingId));
    const results: ImportApplyResult['results'] = [];

    for (const item of items) {
      if (item.status === 'unsupported' || item.status === 'failed') {
        results.push({
          externalListingId: item.externalListingId,
          status: 'skipped',
          reason: item.warnings.join(', ') || item.status,
        });
        continue;
      }
      if (item.status === 'already_imported' && item.proposedChanges?.length === 0) {
        results.push({
          externalListingId: item.externalListingId,
          status: 'skipped',
          listingId: item.existingListingId ?? undefined,
          reason: 'already_imported',
        });
        continue;
      }

      try {
        const existing = context.value.existingListings.find(
          (listing) => listing.marketplaceListingId === item.externalListingId,
        );
        if (existing) {
          await this.updateExistingListing(existing, item.proposed, input.workspaceId, input.actorId);
          results.push({
            externalListingId: item.externalListingId,
            status: 'updated',
            listingId: existing.id,
          });
          continue;
        }

        const { product, listing } = this.createImportedRecords(
          input.workspaceId,
          context.value.marketplace.id,
          item.proposed,
        );
        await this.productRepo.save(product);
        await this.listingRepo.save(listing);
        await this.activityLog?.record({
          id: this.idGenerator(),
          workspaceId: input.workspaceId,
          entityType: 'listing',
          entityId: listing.id,
          actorType: input.actorId ? 'user' : 'hermes',
          actorId: input.actorId,
          action: 'olx_import_adopted',
          metadata: this.auditMetadata(context.value.account.id, item.proposed, 'imported'),
          createdAt: new Date(),
        });
        results.push({
          externalListingId: item.externalListingId,
          status: 'imported',
          productId: product.id,
          listingId: listing.id,
        });
      } catch (error) {
        results.push({
          externalListingId: item.externalListingId,
          status: 'failed',
          reason: error instanceof Error ? error.message : 'unknown import error',
        });
      }
    }

    return Ok({
      marketplaceId: context.value.marketplace.id,
      marketplaceKey: context.value.marketplace.key,
      imported: results.filter((r) => r.status === 'imported').length,
      updated: results.filter((r) => r.status === 'updated').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    });
  }

  private async discover(input: ImportPreviewInput) {
    const marketplace = await this.marketplaceRepo.findByIdForWorkspace(
      input.marketplaceId,
      input.workspaceId,
    );
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${input.marketplaceId}`));
    }
    if (marketplace.key !== 'olx') {
      return Err(new GuardrailViolationError('Import currently supports OLX only'));
    }

    const account = await this.accountRepo.findByMarketplaceId(marketplace.id);
    if (!account || account.status !== 'connected') {
      return Err(new GuardrailViolationError('Connected OLX OAuth account is required for import'));
    }

    const accessToken = await this.accessTokens.getValidAccessToken(marketplace.id);
    const adapter = this.adapters.create(marketplace.key, this.authenticatedHttpClient(accessToken));
    const remoteListings = await adapter.listOwnedListings({
      pageSize: input.pageSize,
      statuses: input.statuses,
    });
    const existingListings = await this.listingRepo.findByMarketplace(marketplace.id);
    return Ok({ marketplace, account, remoteListings, existingListings });
  }

  private buildPreview(
    marketplaceId: string,
    marketplaceKey: MarketplaceKey,
    remoteListings: ImportedMarketplaceListing[],
    existingListings: Awaited<ReturnType<IListingRepository['findByMarketplace']>>,
    failedItems: ImportPreviewItem[],
  ): ImportPreviewResult {
    const existingByExternalId = new Map(
      existingListings.flatMap((listing) =>
        listing.marketplaceListingId ? [[listing.marketplaceListingId, listing] as const] : [],
      ),
    );

    const items = remoteListings.map((remote): ImportPreviewItem => {
      const warnings = this.mappingWarnings(remote);
      const existing = existingByExternalId.get(remote.externalListingId);
      const proposedChanges = existing ? this.proposedListingChanges(existing, remote) : [];
      let status: ImportPreviewItemStatus = 'new';
      if (warnings.includes('missing_required_import_fields')) status = 'unsupported';
      else if (remote.status === 'error') status = 'unsupported';
      else if (existing && proposedChanges.length > 0) status = 'changed';
      else if (existing) status = 'already_imported';

      return {
        status,
        externalListingId: remote.externalListingId,
        externalUrl: remote.externalUrl,
        title: remote.title,
        remoteStatus: remote.remoteStatus ?? null,
        warnings,
        proposed: remote,
        existingListingId: existing?.id ?? null,
        proposedChanges,
      };
    });
    items.push(...failedItems);

    const totals = items.reduce<ImportPreviewResult['totals']>(
      (acc, item) => {
        acc.discovered += 1;
        acc[item.status] += 1;
        return acc;
      },
      { ...EMPTY_TOTALS },
    );

    return { marketplaceId, marketplaceKey, readOnly: true, totals, items };
  }

  private mappingWarnings(remote: ImportedMarketplaceListing): string[] {
    const warnings: string[] = [];
    if (remote.price === null || remote.price === undefined) warnings.push('missing_price');
    if (!remote.currency) warnings.push('missing_currency');
    if (!remote.category) warnings.push('missing_category_mapping');
    if (!remote.description || remote.description.trim().length < 20) warnings.push('missing_description');
    if (!remote.imageUrls || remote.imageUrls.length === 0) warnings.push('missing_photos');
    if (!remote.externalListingId?.trim()) warnings.push('missing_external_id');
    warnings.push('unknown_cost_price');
    warnings.push('unknown_condition_requires_confirmation');
    if (
      warnings.includes('missing_price') ||
      warnings.includes('missing_currency') ||
      warnings.includes('missing_category_mapping') ||
      warnings.includes('missing_description') ||
      warnings.includes('missing_external_id')
    ) {
      warnings.push('missing_required_import_fields');
    }
    return warnings;
  }

  private proposedListingChanges(listing: Listing, remote: ImportedMarketplaceListing): string[] {
    const changes: string[] = [];
    if (remote.price !== null && remote.price !== undefined && listing.price.amount !== remote.price) {
      changes.push('price');
    }
    if (listing.externalUrl !== (remote.externalUrl ?? null)) changes.push('external_url');
    if (listing.status !== remote.status) changes.push('status');
    if (remote.metrics?.views !== undefined && listing.views !== remote.metrics.views) changes.push('views');
    if (remote.metrics?.watchers !== undefined && listing.watchers !== remote.metrics.watchers) changes.push('watchers');
    if (remote.metrics?.messages !== undefined && listing.messages !== remote.metrics.messages) changes.push('messages');
    return changes;
  }

  private createImportedRecords(
    workspaceId: string,
    marketplaceId: string,
    remote: ImportedMarketplaceListing,
  ): { product: Product; listing: Listing } {
    if (remote.price === null || remote.price === undefined || !remote.currency || !remote.category) {
      throw new ValidationError('Remote advert is missing required import fields');
    }
    const costPrice = this.unwrapMoney(0, remote.currency);
    const sellingPrice = this.unwrapMoney(remote.price, remote.currency);
    const now = new Date();
    const product = Product.create({
      id: this.idGenerator(),
      workspaceId,
      sku: `OLX-${remote.externalListingId}`,
      name: remote.title,
      description: remote.description ?? '',
      costPrice,
      sellingPrice,
      condition: this.importedCondition(remote),
      category: remote.category,
      status: remote.status === 'live' ? 'active' : 'draft',
      tags: [IMPORT_TAG, ADOPTED_TAG, UNKNOWN_COST_TAG, UNKNOWN_CONDITION_TAG],
      images: remote.imageUrls,
      createdAt: now,
      updatedAt: now,
    });
    if (product.isErr()) throw product.error;
    const listing = Listing.create({
      id: this.idGenerator(),
      productId: product.value.id,
      marketplaceId,
      marketplaceListingId: remote.externalListingId,
      externalUrl: remote.externalUrl ?? null,
      price: sellingPrice,
      status: remote.status,
      views: remote.metrics?.views ?? null,
      watchers: remote.metrics?.watchers ?? null,
      messages: remote.metrics?.messages ?? null,
      publishedAt: remote.status === 'live' ? now : null,
      lastSyncAt: now,
      syncError: this.syncNote(remote),
      createdAt: now,
      updatedAt: now,
    });
    if (listing.isErr()) throw listing.error;
    return { product: product.value, listing: listing.value };
  }

  private async updateExistingListing(
    listing: Listing,
    remote: ImportedMarketplaceListing,
    workspaceId: string,
    actorId?: string,
  ): Promise<void> {
    if (remote.price !== null && remote.price !== undefined) {
      const price = this.unwrapMoney(remote.price, remote.currency ?? listing.price.currency);
      const priceResult = listing.updatePrice(price);
      if (priceResult.isErr()) throw priceResult.error;
    }
    listing.recordExternalUrl(remote.externalUrl ?? null);
    listing.recordSyncStats(remote.metrics ?? {}, new Date());
    listing.recordSyncStatusNote(this.syncNote(remote));
    await this.listingRepo.save(listing);
    await this.activityLog?.record({
      id: this.idGenerator(),
      workspaceId,
      entityType: 'listing',
      entityId: listing.id,
      actorType: actorId ? 'user' : 'hermes',
      actorId,
      action: 'olx_import_refreshed',
      metadata: this.auditMetadata(undefined, remote, 'updated'),
      createdAt: new Date(),
    });
  }

  private importedCondition(_remote: ImportedMarketplaceListing): ProductCondition {
    // Product.condition is required by the current schema. The import marks this
    // placeholder explicitly with UNKNOWN_CONDITION_TAG and audit metadata so the
    // seller can confirm it rather than treating it as provider truth.
    return 'good';
  }

  private syncNote(remote: ImportedMarketplaceListing): string {
    return `imported_from_olx:${remote.externalListingId}; remote_status=${remote.remoteStatus ?? remote.status}; last_remote_update=${remote.remoteUpdatedAt?.toISOString?.() ?? 'unknown'}`;
  }

  private auditMetadata(
    marketplaceAccountId: string | undefined,
    remote: ImportedMarketplaceListing,
    action: 'imported' | 'updated',
  ): Record<string, unknown> {
    return {
      marketplace: 'olx',
      marketplaceAccountId,
      externalListingId: remote.externalListingId,
      externalUrl: remote.externalUrl ?? null,
      remoteStatus: remote.remoteStatus ?? remote.status,
      remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString?.() ?? null,
      importedAt: new Date().toISOString(),
      action,
      readOnlyProviderOperation: true,
    };
  }

  private unwrapMoney(amount: number, currency: string): Money {
    const result = Money.of(amount, currency);
    if (result.isErr()) throw result.error;
    return result.value;
  }
}
