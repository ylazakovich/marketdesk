import { createHash } from 'node:crypto';
import type { ActorType, ProductCategorySource } from '../../../shared/types';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import type { Listing } from '../../domain/entities/Listing';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IEventRepository } from '../../domain/repositories/interfaces/IEventRepository';
import type {
  ActivityLogEntry,
  IActivityLogRepository,
} from '../../domain/repositories/interfaces/IActivityLogRepository';
import { NotFoundError } from '../../domain/shared/DomainError';
import { evaluateProductCategoryCandidate } from '../../domain/services/ProductCategorySyncPolicy';

export interface ProductCategorySyncRepositories {
  productRepo: IProductRepository;
  listingRepo: IListingRepository;
  marketplaceRepo: IMarketplaceRepository;
  activityLog?: IActivityLogRepository;
  eventRepo?: IEventRepository;
}

export interface ProductCategorySyncInput {
  workspaceId: string;
  listingId: string;
  actorId?: string;
  trigger: 'import' | 'manual' | 'scheduled';
  now?: Date;
}

export interface ProductCategorySyncResult {
  outcome: 'synced' | 'conflict' | 'unchanged' | 'ignored';
  categoryChanged: boolean;
  reason?: string;
}

export function selectProductCategoryTriggerListings(listings: readonly Listing[]): Listing[] {
  const byProduct = new Map<string, Listing>();
  for (const listing of listings) {
    if (listing.isLive() && listing.marketplaceCategory && !byProduct.has(listing.productId)) {
      byProduct.set(listing.productId, listing);
    }
  }
  return [...byProduct.values()];
}

export class ProductCategorySyncService {
  constructor(
    private readonly runInTransaction: <T>(
      work: (repositories: ProductCategorySyncRepositories) => Promise<T>,
    ) => Promise<T>,
    private readonly idGenerator: () => string,
  ) {}

  reconcile(input: ProductCategorySyncInput): Promise<ProductCategorySyncResult> {
    return this.runInTransaction((repositories) => this.reconcileWithRepositories(input, repositories));
  }

  async reconcileWithRepositories(
    input: ProductCategorySyncInput,
    repositories: ProductCategorySyncRepositories,
  ): Promise<ProductCategorySyncResult> {
    const now = input.now ?? new Date();
    const triggerListing = await repositories.listingRepo.findByIdForWorkspace(
      input.listingId,
      input.workspaceId,
    );
    if (!triggerListing) throw new NotFoundError(`Listing not found: ${input.listingId}`);
    if (!triggerListing.isLive() || !triggerListing.marketplaceCategory) {
      return { outcome: 'ignored', categoryChanged: false, reason: 'Trigger listing has no active category' };
    }

    const product = await repositories.productRepo.findByIdForWorkspaceForUpdate(
      triggerListing.productId,
      input.workspaceId,
    );
    if (!product) throw new NotFoundError(`Product not found: ${triggerListing.productId}`);

    const listings = await repositories.listingRepo.findByProduct(product.id);
    const candidates: Array<{ category: string; source: ProductCategorySource }> = [];
    let requiresReview = false;

    for (const listing of listings) {
      if (!listing.isLive() || !listing.marketplaceCategory) continue;
      const marketplace = await repositories.marketplaceRepo.findByIdForWorkspace(
        listing.marketplaceId,
        input.workspaceId,
      );
      if (!marketplace) continue;

      const decision = evaluateProductCategoryCandidate(
        product,
        marketplace.key,
        listing.marketplaceCategory,
        now,
      );
      if (decision.kind === 'ignore') continue;

      const metadata = listing.marketplaceCategory;
      const source: ProductCategorySource = {
        marketplaceKey: marketplace.key,
        marketplaceId: marketplace.id,
        listingId: listing.id,
        providerCategoryId: metadata.providerCategoryId,
        name: metadata.name,
        path: [...metadata.path],
        taxonomyVerifiedAt: metadata.taxonomyVerifiedAt,
        syncedAt: (listing.lastSyncAt ?? now).toISOString(),
      };
      candidates.push({
        category: decision.kind === 'candidate' ? decision.category : metadata.name.trim(),
        source,
      });
      if (decision.kind === 'conflict') requiresReview = true;
    }

    const triggerIncluded = candidates.some(({ source }) => source.listingId === triggerListing.id);
    if (!triggerIncluded) {
      return { outcome: 'ignored', categoryChanged: false, reason: 'Trigger category is not trusted by policy' };
    }

    const categoryKeys = new Set(candidates.map(({ source }) => [
      source.marketplaceKey,
      source.providerCategoryId.trim(),
      ...source.path.map((part) => part.trim().toLocaleLowerCase()),
    ].join('\u0000')));

    if (requiresReview || categoryKeys.size > 1) {
      const { stateChanged, conflictChanged } = product.recordCategoryConflict(
        candidates.map(({ source }) => source),
        now,
      );
      if (!stateChanged) return { outcome: 'unchanged', categoryChanged: false };
      await repositories.productRepo.save(product);
      if (!conflictChanged) return { outcome: 'unchanged', categoryChanged: false };
      await this.recordConflictEvent(repositories.eventRepo, product.id, product.category, candidates.map(({ source }) => source), input.workspaceId, now);
      return { outcome: 'conflict', categoryChanged: false };
    }

    const category = candidates[0]!.category;
    const previousCategory = product.category;
    const result = product.synchronizeCategory(category, candidates.map(({ source }) => source));
    if (result.isErr()) throw result.error;
    if (!result.value.stateChanged) return { outcome: 'unchanged', categoryChanged: false };

    await repositories.productRepo.save(product);
    if (result.value.categoryChanged) {
      await repositories.activityLog?.record(this.activity(input, product.id, 'product.category_synced', {
        previousCategory,
        newCategory: category,
        sources: candidates.map(({ source }) => ({
          marketplaceKey: source.marketplaceKey,
          marketplaceId: source.marketplaceId,
          listingId: source.listingId,
          providerCategoryId: source.providerCategoryId,
          path: source.path,
        })),
      }, now));
    }
    return { outcome: 'synced', categoryChanged: result.value.categoryChanged };
  }

  private activity(
    input: ProductCategorySyncInput,
    entityId: string,
    action: string,
    metadata: Record<string, unknown>,
    now: Date,
  ): ActivityLogEntry {
    const actorType: ActorType = input.actorId ? 'user' : 'hermes';
    return {
      id: this.idGenerator(),
      workspaceId: input.workspaceId,
      actorType,
      actorId: input.actorId,
      action,
      entityType: 'product',
      entityId,
      metadata: { ...metadata, trigger: input.trigger },
      createdAt: now,
    };
  }

  private async recordConflictEvent(
    eventRepo: IEventRepository | undefined,
    productId: string,
    currentCategory: string,
    candidates: ProductCategorySource[],
    workspaceId: string,
    now: Date,
  ): Promise<void> {
    if (!eventRepo) return;
    const sorted = [...candidates].sort((left, right) =>
      this.sourceIdentity(left).localeCompare(this.sourceIdentity(right))
    );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(sorted.map((source) => this.sourceIdentity(source))))
      .digest('hex')
      .slice(0, 24);
    const event = HermesEvent.create({
      id: this.idGenerator(),
      workspaceId,
      productId,
      type: 'product_category_conflict',
      severity: 'warning',
      title: 'Product category conflict requires review',
      detail: 'Active marketplace listings disagree on the verified exact category. No category was selected automatically.',
      proposedChange: {
        kind: 'product_category_conflict',
        productId,
        currentCategory,
        candidates: sorted,
      },
      status: 'pending_review',
      autonomyDecision: 'pending_review',
      createdAt: now,
    });
    if (event.isErr()) throw event.error;
    await eventRepo.saveRecommendationIfAbsent(
      event.value,
      `product-category-conflict:${productId}:${fingerprint}`,
    );
  }

  private sourceIdentity(source: ProductCategorySource): string {
    return [
      source.marketplaceKey,
      source.marketplaceId,
      source.listingId,
      source.providerCategoryId,
      source.name.trim().toLocaleLowerCase(),
      ...source.path.map((part) => part.trim().toLocaleLowerCase()),
    ].join('\u0000');
  }
}
