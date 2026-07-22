import { randomUUID } from 'crypto';
import type {
  MarketplaceCategoryMetadata,
  MarketplaceKey,
  ProductCondition,
} from '../../../shared/types';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type { ICategoryCorrectionOperationRepository } from '../../domain/repositories/interfaces/ICategoryCorrectionOperationRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type {
  ActivityLogEntry,
  IActivityLogRepository,
} from '../../domain/repositories/interfaces/IActivityLogRepository';
import { Money } from '../../domain/valueObjects/Money';
import type {
  IMarketplaceAdapter,
  ImportedMarketplaceListing,
  ImportDiscoveryOptions,
} from '../../domain/services/MarketplaceAdapter';
import type { MarketplaceHttpClient } from '../../infrastructure/adapters/MarketplaceHttpClient';
import type {
  MarketplaceAccountRecord,
  MarketplaceAccountRepository,
  MarketplaceResolvedAccessToken,
} from './MarketplaceOAuthService';
import type { IdGenerator } from '../ports/IdGenerator';
import type { ProductCategorySyncService } from './ProductCategorySyncService';
import { Err, Ok, type Result } from '../../domain/shared/Result';
import {
  GuardrailViolationError,
  InvalidStateError,
  NotFoundError,
  ReconciliationRequiredError,
  ValidationError,
} from '../../domain/shared/DomainError';

export interface ImportMarketplaceAdapterResolver {
  create(key: MarketplaceKey, http?: MarketplaceHttpClient): IMarketplaceAdapter;
}

export interface MarketplaceImportAccessTokenProvider {
  getValidAccessTokenContext(marketplaceId: string): Promise<MarketplaceResolvedAccessToken>;
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
  'new' | 'already_imported' | 'changed' | 'unsupported' | 'failed';

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


export interface MarketplaceImportRepositories {
  productRepo: IProductRepository;
  listingRepo: IListingRepository;
  marketplaceRepo?: IMarketplaceRepository;
  activityLog?: IActivityLogRepository;
  eventRepo: IEventRepository;
  correctionOperations: ICategoryCorrectionOperationRepository;
  accountRepo: MarketplaceAccountRepository & {
    findByMarketplaceIdForUpdate(marketplaceId: string): Promise<MarketplaceAccountRecord | null>;
  };
}

export type MarketplaceImportUnitOfWork = <T>(
  work: (repos: MarketplaceImportRepositories) => Promise<T>
) => Promise<T>;

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
    private readonly unitOfWork: MarketplaceImportUnitOfWork = async () => {
      throw new InvalidStateError('MarketplaceImportService requires a transactional unit of work');
    },
    private readonly eventRepo?: IEventRepository,
    private readonly correctionOperations?: ICategoryCorrectionOperationRepository,
    private readonly productCategorySync?: ProductCategorySyncService,
  ) {}

  async preview(input: ImportPreviewInput): Promise<Result<ImportPreviewResult>> {
    const context = await this.discover(input);
    if (context.isErr()) return context;
    return Ok(
      this.buildPreview(
        context.value.marketplace.id,
        context.value.marketplace.key,
        context.value.remoteListings,
        context.value.existingListings,
        context.value.productsByListingId,
        context.value.failedItems
      )
    );
  }

  async recommendSyncedCategoryMismatch(
    input: {
      listing: Listing;
      workspaceId: string;
      currentCategory: ImportedMarketplaceListing['marketplaceCategory'];
      proposedCategory: ImportedMarketplaceListing['marketplaceCategory'];
      marketplaceAccount: Pick<MarketplaceAccountRecord, 'id' | 'revision'>;
    },
    repositories?: MarketplaceImportRepositories,
  ): Promise<void> {
    const recommend = async (repos: MarketplaceImportRepositories): Promise<void> => {
      const product = await repos.productRepo.findByIdForWorkspace(
        input.listing.productId,
        input.workspaceId,
      );
      const account = await this.requireExactAccountBindingForUpdate(
        input.listing.marketplaceId,
        input.marketplaceAccount,
        repos.accountRepo,
      );
      await this.createCategoryMismatchRecommendation(
        input.listing,
        product,
        input.currentCategory,
        input.proposedCategory,
        input.workspaceId,
        account.id,
        account.revision,
        repos.activityLog,
        repos.eventRepo,
        repos.correctionOperations,
      );
    };
    if (repositories) {
      await recommend(repositories);
    } else {
      await this.unitOfWork(recommend);
    }
  }

  async import(input: ImportApplyInput): Promise<Result<ImportApplyResult>> {
    const context = await this.discover(input);
    if (context.isErr()) return context;

    const importAll = input.externalListingIds === undefined;
    const selected = new Set(input.externalListingIds ?? []);
    const preview = this.buildPreview(
      context.value.marketplace.id,
      context.value.marketplace.key,
      context.value.remoteListings,
      context.value.existingListings,
      context.value.productsByListingId,
      context.value.failedItems
    );
    const items = preview.items.filter((item) => importAll || selected.has(item.externalListingId));
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
        const existing = this.findUniqueExistingListing(
          context.value.existingListings,
          item.externalListingId
        );
        const saved = await this.unitOfWork(async (repos) => {
          await this.requireExactAccountBindingForUpdate(
            context.value.marketplace.id,
            {
              id: context.value.account.id,
              revision: context.value.account.revision,
            },
            repos.accountRepo,
          );
          if (existing) {
            await this.updateExistingListing(
              existing,
              item.proposed,
              input.workspaceId,
              context.value.account.id,
              context.value.account.revision,
              input.actorId,
              repos
            );
            await this.reconcileImportedProductCategory(
              existing.id,
              input.workspaceId,
              input.actorId,
              repos,
            );
            return { status: 'updated' as const, listingId: existing.id };
          }

          const { product, listing } = this.createImportedRecords(
            input.workspaceId,
            context.value.marketplace.id,
            item.proposed
          );
          await repos.productRepo.save(product);
          await repos.listingRepo.save(listing);
          await this.reconcileImportedProductCategory(
            listing.id,
            input.workspaceId,
            input.actorId,
            repos,
          );
          await this.createCategoryMismatchRecommendation(
            listing,
            product,
            item.proposed.marketplaceCategory ?? null,
            null,
            input.workspaceId,
            context.value.account.id,
            context.value.account.revision,
            repos.activityLog,
            repos.eventRepo,
            repos.correctionOperations,
          );
          await repos.activityLog?.record(
            this.activityEntry(
              input.workspaceId,
              listing.id,
              input.actorId,
              'olx_import_adopted',
              this.auditMetadata(context.value.account.id, item.proposed, 'imported')
            )
          );
          return { status: 'imported' as const, productId: product.id, listingId: listing.id };
        });
        results.push({
          externalListingId: item.externalListingId,
          status: saved.status,
          productId: saved.productId,
          listingId: saved.listingId,
        });
      } catch (error) {
        if (error instanceof ReconciliationRequiredError) return Err(error);
        const reason = error instanceof Error ? error.message : 'unknown import error';
        results.push({
          externalListingId: item.externalListingId,
          status: 'failed',
          reason,
        });
        if (reason.includes('reconciliation is required')) {
          break;
        }
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
      input.workspaceId
    );
    if (!marketplace) {
      return Err(new NotFoundError(`Marketplace not found: ${input.marketplaceId}`));
    }
    if (marketplace.key !== 'olx') {
      return Err(new GuardrailViolationError('Import currently supports OLX only'));
    }

    const initialAccount = await this.accountRepo.findByMarketplaceId(marketplace.id);
    if (!initialAccount || initialAccount.status !== 'connected') {
      return Err(new GuardrailViolationError('Connected OLX OAuth account is required for import'));
    }

    let resolvedToken: MarketplaceResolvedAccessToken;
    try {
      resolvedToken = await this.accessTokens.getValidAccessTokenContext(marketplace.id);
      await this.requireExactAccountBinding(marketplace.id, resolvedToken.account);
    } catch (error) {
      if (error instanceof ReconciliationRequiredError) return Err(error);
      return Err(
        new ValidationError(
          error instanceof Error ? error.message : 'Failed to prepare OLX access token'
        )
      );
    }
    const adapter = this.adapters.create(
      marketplace.key,
      this.authenticatedHttpClient(resolvedToken.accessToken)
    );
    let discoveredListings: ImportedMarketplaceListing[];
    let account: MarketplaceAccountRecord;
    try {
      discoveredListings = await adapter.listOwnedListings({
        pageSize: input.pageSize,
        statuses: input.statuses,
      });
      // Bind the remote snapshot to the exact account revision whose token read it.
      // A reconnect, account switch, or second refresh after token resolution makes
      // the snapshot unsafe for persistence or destructive recommendations.
      account = await this.requireExactAccountBinding(marketplace.id, resolvedToken.account);
    } catch (error) {
      if (error instanceof ReconciliationRequiredError) return Err(error);
      return Err(
        new ValidationError(
          error instanceof Error ? error.message : 'Failed to discover owned adverts'
        )
      );
    }
    const { remoteListings, failedItems } = this.normalizeDiscoveredListings(discoveredListings);
    const existingListings = await this.listingRepo.findByMarketplace(marketplace.id);
    const productsByListingId = await this.loadProductsByListingId(
      existingListings,
      input.workspaceId
    );
    return Ok({
      marketplace,
      account,
      remoteListings,
      existingListings,
      productsByListingId,
      failedItems,
    });
  }

  private buildPreview(
    marketplaceId: string,
    marketplaceKey: MarketplaceKey,
    remoteListings: ImportedMarketplaceListing[],
    existingListings: Awaited<ReturnType<IListingRepository['findByMarketplace']>>,
    productsByListingId: Map<string, Product>,
    failedItems: ImportPreviewItem[]
  ): ImportPreviewResult {
    const duplicateExistingExternalIds = this.duplicateExternalIds(
      existingListings.flatMap((listing) => listing.marketplaceListingId ?? [])
    );
    const duplicateRemoteExternalIds = this.duplicateExternalIds(
      remoteListings.map((listing) => listing.externalListingId)
    );
    const existingByExternalId = new Map(
      existingListings.flatMap((listing) =>
        listing.marketplaceListingId &&
        !duplicateExistingExternalIds.has(listing.marketplaceListingId)
          ? [[listing.marketplaceListingId, listing] as const]
          : []
      )
    );

    const items = remoteListings.map((remote): ImportPreviewItem => {
      const warnings = this.mappingWarnings(remote);
      if (duplicateRemoteExternalIds.has(remote.externalListingId))
        warnings.push('duplicate_remote_external_listing_id');
      if (duplicateExistingExternalIds.has(remote.externalListingId))
        warnings.push('duplicate_existing_external_listing_id');
      const existing = existingByExternalId.get(remote.externalListingId);
      const product = existing ? (productsByListingId.get(existing.id) ?? null) : null;
      const proposedChanges = existing
        ? this.proposedListingChanges(existing, product, remote)
        : [];
      let status: ImportPreviewItemStatus = 'new';
      if (warnings.some((warning) => warning.startsWith('duplicate_'))) status = 'failed';
      else if (existing && proposedChanges.length > 0) status = 'changed';
      else if (existing) status = 'already_imported';
      else if (warnings.includes('missing_required_import_fields')) status = 'unsupported';
      else if (remote.status === 'error') status = 'unsupported';

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
      { ...EMPTY_TOTALS }
    );

    return { marketplaceId, marketplaceKey, readOnly: true, totals, items };
  }

  private normalizeDiscoveredListings(discoveredListings: ImportedMarketplaceListing[]): {
    remoteListings: ImportedMarketplaceListing[];
    failedItems: ImportPreviewItem[];
  } {
    const remoteListings: ImportedMarketplaceListing[] = [];
    const failedItems: ImportPreviewItem[] = [];

    discoveredListings.forEach((remote, index) => {
      try {
        this.assertImportedListingShape(remote);
        remoteListings.push(remote);
      } catch (error) {
        const partial = remote as Partial<ImportedMarketplaceListing> | null | undefined;
        const externalListingId = partial?.externalListingId?.trim() || `unmapped-${index + 1}`;
        failedItems.push({
          status: 'failed',
          externalListingId,
          externalUrl: partial?.externalUrl ?? null,
          title: partial?.title ?? 'Unmapped OLX advert',
          remoteStatus: partial?.remoteStatus ?? partial?.status ?? null,
          warnings: [
            'item_mapping_failed',
            error instanceof Error ? error.message : 'Unable to map discovered advert',
          ],
          proposed: this.failedRemoteListingFallback(externalListingId, partial),
          existingListingId: null,
          proposedChanges: [],
        });
      }
    });

    return { remoteListings, failedItems };
  }

  private assertImportedListingShape(remote: ImportedMarketplaceListing): void {
    if (!remote || typeof remote !== 'object') {
      throw new ValidationError('Discovered advert is not an object');
    }
    if (!remote.externalListingId?.trim()) {
      throw new ValidationError('Discovered advert is missing externalListingId');
    }
    if (!remote.title?.trim()) {
      throw new ValidationError(`Discovered advert ${remote.externalListingId} is missing title`);
    }
  }

  private failedRemoteListingFallback(
    externalListingId: string,
    partial: Partial<ImportedMarketplaceListing> | null | undefined
  ): ImportedMarketplaceListing {
    return {
      externalListingId,
      externalUrl: partial?.externalUrl ?? null,
      title: partial?.title ?? 'Unmapped OLX advert',
      description: partial?.description ?? null,
      price: partial?.price ?? null,
      currency: partial?.currency ?? null,
      status: partial?.status ?? 'error',
      remoteStatus: partial?.remoteStatus ?? null,
      category: partial?.category ?? null,
      marketplaceCategory: partial?.marketplaceCategory ?? null,
      imageUrls: partial?.imageUrls ?? [],
      remoteUpdatedAt: partial?.remoteUpdatedAt ?? null,
      metrics: partial?.metrics ?? {},
    };
  }

  private mappingWarnings(remote: ImportedMarketplaceListing): string[] {
    const warnings: string[] = [];
    if (remote.price === null || remote.price === undefined) warnings.push('missing_price');
    if (!remote.currency) warnings.push('missing_currency');
    if (!remote.category) warnings.push('missing_category_mapping');
    if (!remote.description || remote.description.trim().length < 20)
      warnings.push('missing_description');
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

  private proposedListingChanges(
    listing: Listing,
    product: Product | null,
    remote: ImportedMarketplaceListing
  ): string[] {
    const changes: string[] = [];
    if (
      remote.price !== null &&
      remote.price !== undefined &&
      listing.price.amount !== remote.price
    ) {
      changes.push('price');
    }
    if (listing.externalUrl !== (remote.externalUrl ?? null)) changes.push('external_url');
    if (
      remote.marketplaceCategory != null
      && !this.sameMarketplaceCategoryIdentity(listing.marketplaceCategory, remote.marketplaceCategory)
    )
      changes.push('marketplace_category');
    if (listing.status !== remote.status) changes.push('status');
    if (remote.metrics?.views !== undefined && listing.views !== remote.metrics.views)
      changes.push('views');
    if (remote.metrics?.watchers !== undefined && listing.watchers !== remote.metrics.watchers)
      changes.push('watchers');
    if (
      remote.metrics?.conversations !== undefined &&
      listing.conversations !== remote.metrics.conversations
    )
      changes.push('conversations');
    if (remote.metrics?.messages !== undefined && listing.messages !== remote.metrics.messages)
      changes.push('messages');
    if (product) {
      if (product.name !== remote.title) changes.push('product_title');
      if ((remote.description ?? '') !== product.description) changes.push('product_description');
      if (!this.sameStringList([...product.images], remote.imageUrls))
        changes.push('product_images');
      if (
        remote.price !== null &&
        remote.price !== undefined &&
        product.sellingPrice.amount !== remote.price
      ) {
        changes.push('product_selling_price');
      }
      if (
        this.productCategorySync
        && remote.marketplaceCategory
        && (
          product.category !== remote.marketplaceCategory.name.trim()
          || product.categoryProvenance?.status !== 'synced'
          || !product.categoryProvenance.sources.some((source) => source.listingId === listing.id)
        )
      ) {
        changes.push('product_category');
      }
    }
    return changes;
  }

  private async reconcileImportedProductCategory(
    listingId: string,
    workspaceId: string,
    actorId: string | undefined,
    repos: MarketplaceImportRepositories,
  ): Promise<void> {
    if (!this.productCategorySync) return;
    await this.productCategorySync.reconcileWithRepositories(
      { workspaceId, listingId, actorId, trigger: 'import' },
      {
        productRepo: repos.productRepo,
        listingRepo: repos.listingRepo,
        marketplaceRepo: repos.marketplaceRepo ?? this.marketplaceRepo,
        activityLog: repos.activityLog,
        eventRepo: repos.eventRepo,
      },
    );
  }

  private createImportedRecords(
    workspaceId: string,
    marketplaceId: string,
    remote: ImportedMarketplaceListing
  ): { product: Product; listing: Listing } {
    if (
      remote.price === null ||
      remote.price === undefined ||
      !remote.currency ||
      !remote.category
    ) {
      throw new ValidationError('Remote advert is missing required import fields');
    }
    const costPrice = null;
    const sellingPrice = this.unwrapMoney(remote.price, remote.currency);
    const now = new Date();
    const product = Product.create({
      id: this.idGenerator(),
      workspaceId,
      sku: `OLX-${workspaceId}-${remote.externalListingId}`,
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
      remoteStatus: remote.remoteStatus ?? null,
      marketplaceCategory: remote.marketplaceCategory ?? null,
      views: remote.metrics?.views ?? null,
      watchers: remote.metrics?.watchers ?? null,
      conversations: remote.metrics?.conversations ?? null,
      messages: remote.metrics?.messages ?? null,
      publishedAt: remote.status === 'live' ? now : null,
      lastSyncAt: now,
      syncError: null,
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
    marketplaceAccountId: string,
    marketplaceAccountRevision: number,
    actorId: string | undefined,
    repos: MarketplaceImportRepositories
  ): Promise<void> {
    const product = await repos.productRepo.findByIdForWorkspaceForUpdate(listing.productId, workspaceId);
    const currentListing = await repos.listingRepo.findByIdForWorkspace(listing.id, workspaceId);
    if (!currentListing || currentListing.productId !== listing.productId) {
      throw new NotFoundError(`Listing not found: ${listing.id}`);
    }
    listing = currentListing;
    const proposedCategory = listing.marketplaceCategory;
    if (remote.price !== null && remote.price !== undefined) {
      const price = this.unwrapMoney(remote.price, remote.currency ?? listing.price.currency);
      const priceResult = listing.updatePrice(price);
      if (priceResult.isErr()) throw priceResult.error;
    }
    if (remote.status === 'live' && product && !product.canPublish()) {
      const statusRecorded = listing.recordImportedStatus(remote.status, product);
      if (statusRecorded.isErr()) throw statusRecorded.error;
    }
    if (product) {
      if (product.name !== remote.title) {
        const renamed = product.rename(remote.title);
        if (renamed.isErr()) throw renamed.error;
      }
      if (
        remote.description !== undefined &&
        remote.description !== null &&
        product.description !== remote.description
      ) {
        const described = product.updateDescription(remote.description);
        if (described.isErr()) throw described.error;
      }
      // A provider category label is marketplace metadata, not the product's broad
      // semantic identity. Preserve the local category until a user changes it.
      if (!this.sameStringList([...product.images], remote.imageUrls)) {
        product.clearImages();
        for (const imageUrl of remote.imageUrls) {
          const added = product.addImage(imageUrl);
          if (added.isErr()) throw added.error;
        }
      }
      if (
        remote.price !== null &&
        remote.price !== undefined &&
        product.sellingPrice.amount !== remote.price
      ) {
        const selling = this.unwrapMoney(
          remote.price,
          remote.currency ?? product.sellingPrice.currency
        );
        const priced = product.updateSellingPrice(selling);
        if (priced.isErr()) throw priced.error;
      }
      await repos.productRepo.save(product);
    }
    listing.recordExternalUrl(remote.externalUrl ?? null);
    if (remote.marketplaceCategory != null) {
      listing.recordMarketplaceCategory(remote.marketplaceCategory);
    }
    const statusRecorded = listing.recordImportedStatus(remote.status, product ?? null);
    if (statusRecorded.isErr()) throw statusRecorded.error;
    if (remote.metrics?.conversations === null || remote.metrics?.messages === null) {
      listing.recordMessagesUnavailable();
    }
    listing.recordSyncStats(remote.metrics ?? {}, new Date());
    listing.recordSyncStatusNote(null);
    await repos.listingRepo.save(listing);
    if (remote.marketplaceCategory != null) {
      await this.createCategoryMismatchRecommendation(
        listing,
        product,
        remote.marketplaceCategory,
        proposedCategory,
        workspaceId,
        marketplaceAccountId,
        marketplaceAccountRevision,
        repos.activityLog,
        repos.eventRepo,
        repos.correctionOperations,
      );
    }
    await repos.activityLog?.record(
      this.activityEntry(
        workspaceId,
        listing.id,
        actorId,
        'olx_import_refreshed',
        this.auditMetadata(marketplaceAccountId, remote, 'updated')
      )
    );
  }

  private async createCategoryMismatchRecommendation(
    listing: Listing,
    product: Product | null,
    currentCategory: ImportedMarketplaceListing['marketplaceCategory'],
    proposedCategory: ImportedMarketplaceListing['marketplaceCategory'],
    workspaceId: string,
    marketplaceAccountId: string,
    marketplaceAccountRevision: number,
    activityLog: IActivityLogRepository | undefined,
    transactionEventRepo: IEventRepository,
    transactionCorrectionOperations: ICategoryCorrectionOperationRepository,
  ): Promise<void> {
    if (!product || listing.status !== 'live' || !currentCategory) return;
    const account = await this.requireExactAccountBinding(listing.marketplaceId, {
      id: marketplaceAccountId,
      revision: marketplaceAccountRevision,
    });
    const currentDecision = evaluateOlxCategory(product, currentCategory);
    const proposedDecision = proposedCategory ? evaluateOlxCategory(product, proposedCategory) : null;
    if (currentDecision.reason !== 'semantic_mismatch') return;
    const usableMarketplaceAccountId = account.id;
    const usableMarketplaceAccountRevision = account.revision;
    const usableProposedCategory: NonNullable<ImportedMarketplaceListing['marketplaceCategory']> | null =
      proposedDecision?.allowed ? (proposedCategory ?? null) : null;
    const eventId = this.idGenerator();
    const delistIntentId = this.idGenerator();
    const recreateIntentId = this.idGenerator();
    const created = HermesEvent.create({
      id: eventId,
      workspaceId,
      productId: product.id,
      type: 'olx_category_mismatch',
      severity: 'critical',
      status: 'pending_review',
      title: 'OLX advert category mismatch requires recreation',
      detail: `Current: ${currentCategory.path.join(' → ')}. Proposed: ${usableProposedCategory ? usableProposedCategory.path.join(' → ') : 'select an exact verified OLX leaf category'}. OLX category is not corrected through a normal PUT; delist and recreate remain separate human-reviewed operations.`,
      proposedChange: {
        kind: 'category_recreation',
        listingId: listing.id,
        currentCategory: currentCategory!,
        proposedCategory: usableProposedCategory,
        operations: [
          {
            kind: 'delist', intentId: delistIntentId, status: 'pending_review',
            providerSideEffectAllowed: false, quotaUnitsRestored: 0,
          },
          {
            kind: 'recreate', intentId: recreateIntentId,
            status: 'blocked_pending_quota_review', providerSideEffectAllowed: false,
            quotaGuardRequired: true,
          },
        ],
      },
      autonomyDecision: 'pending_review',
    });
    if (created.isErr()) throw created.error;
    const inserted = await transactionEventRepo.saveRecommendationIfAbsent(
      created.value,
      `olx-category-mismatch:${listing.id}:${currentCategory.providerCategoryId}:${usableProposedCategory?.providerCategoryId ?? 'unresolved'}`,
    );
    if (!inserted) return;
    {
      const requestedAt = new Date();
      await transactionCorrectionOperations.createPair(
        {
          id: delistIntentId, workspaceId, recommendationEventId: eventId,
          listingId: listing.id, marketplaceId: listing.marketplaceId, kind: 'delist',
          state: 'requested', targetCategory: null, paidOverrideReason: null,
          requestedBy: null, approvedBy: null, result: {
            externalListingId: listing.marketplaceListingId,
            externalUrl: listing.externalUrl,
            requestedListingUpdatedAt: listing.updatedAt.toISOString(),
            marketplaceAccountId: usableMarketplaceAccountId,
            marketplaceAccountRevision: usableMarketplaceAccountRevision,
          }, requestedAt,
          approvedAt: null, executedAt: null, failedAt: null, updatedAt: requestedAt,
        },
        {
          id: recreateIntentId, workspaceId, recommendationEventId: eventId,
          listingId: listing.id, marketplaceId: listing.marketplaceId, kind: 'recreate',
          state: 'requested', targetCategory: usableProposedCategory, paidOverrideReason: null,
          requestedBy: null, approvedBy: null, result: null, requestedAt,
          approvedAt: null, executedAt: null, failedAt: null, updatedAt: requestedAt,
        },
      );
    }
    await activityLog?.record(this.activityEntry(
      workspaceId,
      listing.id,
      undefined,
      'olx.category_recreation_recommended',
      {
        eventId,
        currentCategory,
        proposedCategory: usableProposedCategory,
        delistIntentId,
        recreateIntentId,
        deletionRestoresQuota: false,
        recreateRequiresQuotaGuard: true,
      },
    ));
  }

  private async requireExactAccountBinding(
    marketplaceId: string,
    expected: Pick<MarketplaceAccountRecord, 'id' | 'revision'>,
  ): Promise<MarketplaceAccountRecord> {
    const account = await this.accountRepo.findByMarketplaceId(marketplaceId);
    return this.assertExactAccountBinding(account, expected);
  }

  private async requireExactAccountBindingForUpdate(
    marketplaceId: string,
    expected: Pick<MarketplaceAccountRecord, 'id' | 'revision'>,
    accountRepo: MarketplaceImportRepositories['accountRepo'],
  ): Promise<MarketplaceAccountRecord> {
    const account = await accountRepo.findByMarketplaceIdForUpdate(marketplaceId);
    return this.assertExactAccountBinding(account, expected);
  }

  private assertExactAccountBinding(
    account: MarketplaceAccountRecord | null,
    expected: Pick<MarketplaceAccountRecord, 'id' | 'revision'>,
  ): MarketplaceAccountRecord {
    if (!account || account.status !== 'connected'
      || account.id !== expected.id || account.revision !== expected.revision) {
      throw new ReconciliationRequiredError(
        'OLX account changed after token resolution; reconciliation is required'
      );
    }
    return account;
  }

  private importedCondition(_remote: ImportedMarketplaceListing): ProductCondition {
    return 'unknown';
  }

  private async loadProductsByListingId(
    listings: Awaited<ReturnType<IListingRepository['findByMarketplace']>>,
    workspaceId: string
  ): Promise<Map<string, Product>> {
    const entries = await Promise.all(
      listings.map(async (listing) => {
        const product = await this.productRepo.findByIdForWorkspace(listing.productId, workspaceId);
        return product ? ([listing.id, product] as const) : null;
      })
    );
    return new Map(entries.filter((entry): entry is [string, Product] => entry !== null));
  }

  private duplicateExternalIds(ids: string[]): Set<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (!id) continue;
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    return duplicates;
  }

  private findUniqueExistingListing(
    listings: Awaited<ReturnType<IListingRepository['findByMarketplace']>>,
    externalListingId: string
  ): Listing | null {
    const matches = listings.filter(
      (listing) => listing.marketplaceListingId === externalListingId
    );
    if (matches.length > 1) {
      throw new ValidationError(`Duplicate local listing identity for ${externalListingId}`);
    }
    return matches[0] ?? null;
  }

  private sameStringList(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private sameMarketplaceCategoryIdentity(
    left: MarketplaceCategoryMetadata | null,
    right: MarketplaceCategoryMetadata | null,
  ): boolean {
    if (left === null || right === null) return left === right;
    const canonical = (category: MarketplaceCategoryMetadata) => JSON.stringify({
      providerCategoryId: category.providerCategoryId.trim(),
      name: category.name.trim().toLocaleLowerCase(),
      path: category.path.map((part) => part.trim().toLocaleLowerCase()),
      source: category.source,
      confidence: category.confidence,
      isLeaf: category.isLeaf,
      taxonomyVerifiedAt: category.taxonomyVerifiedAt,
      taxonomyStaleAt: category.taxonomyStaleAt,
    });
    return canonical(left) === canonical(right);
  }

  private activityEntry(
    workspaceId: string,
    listingId: string,
    actorId: string | undefined,
    action: string,
    metadata: Record<string, unknown>
  ): ActivityLogEntry {
    return {
      id: this.idGenerator(),
      workspaceId,
      entityType: 'listing',
      entityId: listingId,
      actorType: actorId ? 'user' : 'hermes',
      actorId,
      action,
      metadata,
      createdAt: new Date(),
    };
  }

  private syncNote(remote: ImportedMarketplaceListing): string {
    return `imported_from_olx:${remote.externalListingId}; remote_status=${remote.remoteStatus ?? remote.status}; last_remote_update=${remote.remoteUpdatedAt?.toISOString?.() ?? 'unknown'}`;
  }

  private auditMetadata(
    marketplaceAccountId: string | undefined,
    remote: ImportedMarketplaceListing,
    action: 'imported' | 'updated'
  ): Record<string, unknown> {
    return {
      marketplace: 'olx',
      marketplaceAccountId,
      externalListingId: remote.externalListingId,
      externalUrl: remote.externalUrl ?? null,
      remoteStatus: remote.remoteStatus ?? remote.status,
      remoteUpdatedAt: remote.remoteUpdatedAt?.toISOString?.() ?? null,
      marketplaceCategory: remote.marketplaceCategory ?? null,
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
