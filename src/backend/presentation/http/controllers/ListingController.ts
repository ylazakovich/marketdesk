// Thin HTTP adapter for listing resources. Reads/publish/sync delegate to the
// application service. `update` (price) and `relist` are localized state transitions
// on the Listing aggregate performed via the injected repository, because the
// application layer exposes no dedicated use case for them yet (a future
// UpdateListingUseCase should absorb this). Price history is served through the
// IPriceHistoryReader read port; when Group 6 has not wired a reader it degrades to
// an empty list.

import type { Request, Response, NextFunction } from 'express';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IPriceHistoryReader } from '../../../application/ports/IPriceHistoryReader';
import type { IPriceHistoryRecorder } from '../../../application/ports/IPriceHistoryRecorder';
import type { IdGenerator } from '../../../application/ports/IdGenerator';
import { Money } from '../../../domain/valueObjects/Money';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { presentListing } from '../../../application/dto/presenters';
import { evaluatePublishEligibility } from '../../../application/usecases/PublishListingUseCase';
import type { OlxPublicationQuotaService } from '../../../application/services/OlxPublicationQuotaService';
import { evaluateOlxCategory } from '../../../domain/services/OlxCategoryGuard';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';
import { ok, paginated } from '../formatters/ResponseFormatter';


function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export interface ListingControllerDeps {
  priceHistoryReader?: IPriceHistoryReader;
  priceHistoryRecorder?: IPriceHistoryRecorder;
  idGenerator?: IdGenerator;
  productRepo?: IProductRepository;
  marketplaceRepo?: IMarketplaceRepository;
  olxQuotaService?: OlxPublicationQuotaService;
}

export class ListingController {
  constructor(
    private readonly listings: ListingApplicationService,
    private readonly listingRepo: IListingRepository,
    private readonly deps: ListingControllerDeps = {},
  ) {}


  private async buildPublishPreview(listingId: string, workspaceId: string) {
    const listing = await this.listingRepo.findByIdForWorkspace(listingId, workspaceId);
    if (!listing) return null;
    const product = this.deps.productRepo
      ? await this.deps.productRepo.findByIdForWorkspace(listing.productId, workspaceId)
      : null;
    const marketplace = this.deps.marketplaceRepo
      ? await this.deps.marketplaceRepo.findByIdForWorkspace(listing.marketplaceId, workspaceId)
      : null;

    const warnings: string[] = [];
    if (!product) warnings.push(`Product not found: ${listing.productId}`);
    if (!marketplace) warnings.push(`Marketplace not found: ${listing.marketplaceId}`);
    if (product && marketplace) {
      warnings.push(...evaluatePublishEligibility(listing, product, marketplace).warnings);
      if (marketplace.key === 'olx') {
        const categoryDecision = evaluateOlxCategory(product, listing.marketplaceCategory);
        if (!categoryDecision.allowed && categoryDecision.message) warnings.push(categoryDecision.message);
      }
    }

    let quotaDecision;
    if (product && marketplace && marketplace.key === 'olx') {
      quotaDecision = this.deps.olxQuotaService
        ? await this.deps.olxQuotaService.preview({ listing, product, marketplace })
        : {
            applicable: true,
            marketplaceKey: 'olx' as const,
            status: 'unknown' as const,
            decision: 'block' as const,
            reason: 'quota_guard_unavailable',
            requiresOverride: true,
          };
      if (quotaDecision.decision === 'block') {
        warnings.push(`OLX quota blocks publication: ${quotaDecision.reason}`);
      }
    }

    return {
      dryRun: true,
      canPublish: warnings.length === 0,
      listingId: listing.id,
      status: listing.status,
      marketplaceKey: marketplace?.key,
      payload: product
        ? {
            productName: product.name,
            description: product.description,
            price: listing.price.amount,
            currency: listing.price.currency,
            category: product.category,
            marketplaceCategory: listing.marketplaceCategory,
            condition: product.condition,
            imageCount: product.images.length,
          }
        : null,
      warnings,
      quotaDecision,
      marketplaceCategory: listing.marketplaceCategory,
    };
  }

  setMarketplaceCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    const listing = await this.listingRepo.findByIdForWorkspace(listingId, req.user!.workspaceId!);
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));
    listing.recordMarketplaceCategory(req.body as MarketplaceCategoryMetadata);
    await this.listingRepo.save(listing);
    ok(res, presentListing(listing));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const page = await this.listings.listByWorkspace(
      req.user!.workspaceId!,
      limit,
      offset,
    );
    paginated(res, page.items, {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: page.totalPages,
    });
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    const listing = await this.listings.getListing(
      listingId,
      req.user!.workspaceId!,
    );
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));
    ok(res, listing);
  };

  publishPreview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    const preview = await this.buildPublishPreview(listingId, req.user!.workspaceId!);
    if (!preview) return next(new NotFoundError(`Listing not found: ${listingId}`));
    ok(res, preview);
  };

  publish = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    if (req.body?.dryRun === true) {
      return this.publishPreview(req, res, next);
    }
    // Tenant-scoped load (S2) so a listing cannot be published on another tenant's
    // behalf — mirrors the relist/update guard rather than a bare findById.
    const listing = await this.listingRepo.findByIdForWorkspace(
      listingId,
      req.user!.workspaceId!,
    );
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));
    const result = await this.listings.publishListing({
      listingId: listing.id,
      actorId: req.user!.userId,
      quotaOverride: req.body?.quotaOverride,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    // Tenant-scoped load so price cannot be changed on another tenant's listing (S2).
    const listing = await this.listingRepo.findByIdForWorkspace(
      listingId,
      req.user!.workspaceId!,
    );
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));

    if (typeof req.body?.price === 'number') {
      const oldPrice = listing.price.amount;
      const money = Money.of(req.body.price, listing.price.currency);
      if (money.isErr()) return next(money.error);
      const updated = listing.updatePrice(money.value);
      if (updated.isErr()) return next(updated.error);
      await this.listingRepo.save(listing);

      if (this.deps.priceHistoryRecorder && this.deps.idGenerator) {
        await this.deps.priceHistoryRecorder.record({
          id: this.deps.idGenerator(),
          listingId: listing.id,
          oldPrice,
          newPrice: listing.price.amount,
          changedBy: 'user',
          reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
          createdAt: new Date(),
        });
      }
    }
    ok(res, presentListing(listing));
  };

  relist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const listingId = routeParam(req.params.id);
    // Tenant-scoped load (S2), then route through the publish use case so relist
    // honours the same invariants as publishing — it rejects a sold product and
    // enqueues an actual republish job rather than only flipping status in the DB
    // (C6). The publish use case validates marketplace-connected / price-set /
    // not-sold and enqueues the republish.
    const listing = await this.listingRepo.findByIdForWorkspace(
      listingId,
      req.user!.workspaceId!,
    );
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));
    const result = await this.listings.relistListing({
      listingId: listing.id,
      actorId: req.user!.userId,
      quotaOverride: req.body?.quotaOverride,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value, 202);
  };

  priceHistory = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const listingId = routeParam(req.params.id);
    const listing = await this.listings.getListing(
      listingId,
      req.user!.workspaceId!,
    );
    if (!listing) return next(new NotFoundError(`Listing not found: ${listingId}`));
    // TODO(Group 6): wire IPriceHistoryReader to PriceHistoryRepository. Until then
    // this returns an empty history rather than failing.
    const history = this.deps.priceHistoryReader
      ? await this.deps.priceHistoryReader.findByListing(listingId)
      : [];
    ok(res, history);
  };
}
