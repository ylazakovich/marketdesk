import type {
  MarketplaceCategoryMetadata,
  ProductCategorySource,
  ProductRecheckItem,
  ProductRecheckItemStatus,
  ProductRecheckResult,
} from '../../../shared/types';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IActivityLogRepository } from '../../domain/repositories/interfaces/IActivityLogRepository';
import type { MarketplaceAccountRepository } from './MarketplaceOAuthService';
import { ConflictError, DomainError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/DomainError';
import { evaluateOlxCategory } from '../../domain/services/OlxCategoryGuard';
import { evaluatePublishEligibility } from '../usecases/PublishListingUseCase';
import type { OlxTrustedTaxonomyResolver } from '../../infrastructure/adapters/OlxTaxonomyResolver';

export interface RecheckProductInput {
  productId: string;
  listingId: string;
  workspaceId: string;
  actorId?: string;
}

export type OlxTaxonomyResolverFactory = (marketplaceId: string) => Promise<OlxTrustedTaxonomyResolver>;

function item(
  key: ProductRecheckItem['key'],
  status: ProductRecheckItemStatus,
  message: string,
  editField?: ProductRecheckItem['editField'],
): ProductRecheckItem {
  return { key, status, message, ...(editField ? { editField } : {}) };
}

function overallStatus(items: ProductRecheckItem[]): ProductRecheckItemStatus {
  if (items.some(({ status }) => status === 'fix')) return 'fix';
  if (items.some(({ status }) => status === 'review')) return 'review';
  return 'ready';
}

function suggestionFromProduct(
  sources: ProductCategorySource[] | undefined,
  currentId: string | null,
  marketplaceId: string,
  listingId: string,
): MarketplaceCategoryMetadata | null {
  const candidate = sources?.find((source) =>
    source.marketplaceKey === 'olx'
      && source.marketplaceId === marketplaceId
      && source.listingId === listingId
      && source.providerCategoryId !== currentId);
  if (!candidate) return null;
  return {
    providerCategoryId: candidate.providerCategoryId,
    name: candidate.name,
    path: candidate.path,
    source: 'remote_import',
    confidence: 0,
    isLeaf: false,
    taxonomyVerifiedAt: candidate.taxonomyVerifiedAt,
    taxonomyStaleAt: candidate.syncedAt,
  };
}

export class ProductRecheckService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly accountRepo: MarketplaceAccountRepository,
    private readonly activityLog: IActivityLogRepository,
    private readonly olxTaxonomyResolver: OlxTaxonomyResolverFactory,
    private readonly idGenerator: () => string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async recheck(input: RecheckProductInput): Promise<ProductRecheckResult> {
    const product = await this.productRepo.findByIdForWorkspace(input.productId, input.workspaceId);
    if (!product) throw new NotFoundError(`Product not found: ${input.productId}`);
    const checkedAt = this.clock();
    const productUpdatedAt = product.updatedAt.toISOString();
    await this.activityLog.record({
      id: this.idGenerator(), workspaceId: input.workspaceId, entityType: 'product', entityId: product.id,
      actorType: 'user', actorId: input.actorId, action: 'product.recheck.started',
      metadata: { productUpdatedAt, listingId: input.listingId, checkedAt: checkedAt.toISOString() },
      createdAt: checkedAt,
    });

    try {
      const listing = await this.listingRepo.findByIdForWorkspace(input.listingId, input.workspaceId);
      if (!listing || listing.productId !== product.id) {
        throw new NotFoundError(`Listing not found for product: ${input.listingId}`);
      }
      const listingUpdatedAt = listing.updatedAt.toISOString();
      const marketplace = await this.marketplaceRepo.findByIdForWorkspace(listing.marketplaceId, input.workspaceId);
      if (!marketplace || marketplace.key !== 'olx') {
        throw new NotFoundError(`OLX marketplace not found for listing: ${input.listingId}`);
      }
      const account = await this.accountRepo.findByMarketplaceId(marketplace.id);
      const accountRevision = account?.revision ?? null;
      const accountConnected = marketplace.isConnected() && account?.status === 'connected';
      const persistedCategory = listing.marketplaceCategory;
      let category: MarketplaceCategoryMetadata | null = null;
      let resolver: OlxTrustedTaxonomyResolver | undefined;
      if (persistedCategory && accountConnected) {
        try {
          resolver = await this.olxTaxonomyResolver(marketplace.id);
          category = await resolver.verify(persistedCategory.providerCategoryId);
        } catch {
          throw new ServiceUnavailableError('Could not verify the current OLX taxonomy; run the check again');
        }
      }

      const checks: ProductRecheckItem[] = [];
      checks.push(product.name.trim().length >= 3
        ? item('title', 'ready', 'Title is present')
        : item('title', 'fix', 'Add a descriptive product title', 'name'));
      checks.push(product.description.trim().length >= 20
        ? item('description', 'ready', 'Description meets the minimum detail requirement')
        : item('description', 'fix', 'Description must contain at least 20 characters', 'description'));
      checks.push(listing.price.amount > 0
        ? item('price', 'ready', 'Target listing price is greater than zero')
        : item('price', 'fix', 'Set the target listing price greater than zero', 'sellingPrice'));
      const eligibility = evaluatePublishEligibility(listing, product, marketplace);
      const requiredField = !marketplace.isConnected()
        ? 'marketplace'
        : !product.canPublish()
          ? undefined
          : listing.price.isZero()
            ? 'sellingPrice'
            : product.condition === 'unknown'
              ? 'condition'
              : undefined;
      checks.push(product.condition !== 'unknown' && eligibility.canPublish
        ? item('required_fields', 'ready', 'Required product and listing fields are valid')
        : item('required_fields', 'fix', eligibility.warnings[0] ?? 'Complete required product fields', requiredField));
      checks.push(product.imageCount > 0
        ? item('media', 'ready', `${product.imageCount} product image${product.imageCount === 1 ? '' : 's'} available`)
        : item('media', 'fix', 'Add at least one product image', 'images'));
      checks.push(accountConnected
        ? item('marketplace', 'ready', `${marketplace.name} OAuth account is connected`)
        : item('marketplace', 'fix', 'Connect the target OLX OAuth account before publication', 'marketplace'));

      const guard = evaluateOlxCategory(product, category, checkedAt);
      const categoryStatus: ProductRecheckItemStatus = guard.allowed
        ? 'ready'
        : guard.reason === 'semantic_mismatch' || guard.reason === 'category_low_confidence'
          ? 'review'
          : 'fix';
      checks.push(item(
        'category', categoryStatus,
        guard.allowed ? `Exact category verified: ${category!.path.join(' → ')}` : (guard.message ?? 'Review the exact provider category'),
        'category',
      ));

      const suggestionSource = product.categoryProvenance?.status === 'conflict'
        ? product.categoryProvenance.candidates
        : undefined;
      const rawSuggestion = suggestionFromProduct(
        suggestionSource, category?.providerCategoryId ?? null, marketplace.id, listing.id,
      );
      let suggestion: MarketplaceCategoryMetadata | null = null;
      if (rawSuggestion && accountConnected) {
        try {
          resolver ??= await this.olxTaxonomyResolver(marketplace.id);
          suggestion = await resolver.verify(rawSuggestion.providerCategoryId);
        } catch {
          suggestion = null;
        }
      }

      const currentProduct = await this.productRepo.findByIdForWorkspace(product.id, input.workspaceId);
      const currentListing = await this.listingRepo.findByIdForWorkspace(listing.id, input.workspaceId);
      const currentMarketplace = await this.marketplaceRepo.findByIdForWorkspace(marketplace.id, input.workspaceId);
      const currentAccount = await this.accountRepo.findByMarketplaceId(marketplace.id);
      if (
        !currentProduct || currentProduct.updatedAt.toISOString() !== productUpdatedAt
        || !currentListing || currentListing.updatedAt.toISOString() !== listingUpdatedAt
        || !currentMarketplace || currentMarketplace.isConnected() !== marketplace.isConnected()
        || (currentAccount?.revision ?? null) !== accountRevision
        || currentAccount?.status !== account?.status
      ) {
        throw new ConflictError('Product, listing, or marketplace changed during recheck; run the check again');
      }

      const status = overallStatus(checks);
      const result: ProductRecheckResult = {
        productId: product.id, listingId: listing.id, marketplaceId: marketplace.id,
        workspaceId: product.workspaceId, productUpdatedAt, listingUpdatedAt,
        accountRevision, checkedAt: checkedAt.toISOString(), status,
        canPublish: status === 'ready', autoApplied: false, items: checks,
        category: {
          providerCategoryId: category?.providerCategoryId ?? null,
          path: category?.path ?? [], confidence: category?.confidence ?? null,
          isLeaf: category?.isLeaf ?? null, taxonomyVerifiedAt: category?.taxonomyVerifiedAt ?? null,
          taxonomyStaleAt: category?.taxonomyStaleAt ?? null, reason: guard.reason ?? null,
          suggestion, confirmationRequired: suggestion !== null,
        },
      };
      await this.activityLog.record({
        id: this.idGenerator(), workspaceId: input.workspaceId, entityType: 'product', entityId: product.id,
        actorType: 'user', actorId: input.actorId, action: 'product.recheck.completed',
        metadata: {
          productUpdatedAt, listingId: listing.id, listingUpdatedAt, marketplaceId: marketplace.id,
          accountRevision, checkedAt: result.checkedAt, status: result.status,
          itemStatuses: Object.fromEntries(result.items.map((entry) => [entry.key, entry.status])),
          categoryReason: result.category.reason, providerCategoryId: result.category.providerCategoryId,
          suggestionProviderCategoryId: suggestion?.providerCategoryId ?? null,
        },
        createdAt: checkedAt,
      });
      return result;
    } catch (error) {
      try {
        await this.activityLog.record({
          id: this.idGenerator(), workspaceId: input.workspaceId, entityType: 'product', entityId: product.id,
          actorType: 'user', actorId: input.actorId, action: 'product.recheck.failed',
          metadata: {
            productUpdatedAt, listingId: input.listingId, checkedAt: checkedAt.toISOString(),
            errorCode: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
          },
          createdAt: checkedAt,
        });
      } catch {
        // Preserve the original failure; audit persistence errors are reported by infrastructure monitoring.
      }
      throw error;
    }
  }
}
