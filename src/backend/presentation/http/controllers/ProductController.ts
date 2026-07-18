// Thin HTTP adapter for product resources. Parses the request, derives the tenant
// (workspaceId) from the authenticated principal, delegates to the application
// service, and translates the Result via ResponseFormatter. No business logic here.

import type { Request, Response, NextFunction } from 'express';
import type { ProductApplicationService } from '../../../application/services/ProductApplicationService';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { ProductAIDraftService } from '../../../application/services/ProductAIDraftService';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { CreateProductDTO } from '../../../application/dto/CreateProductDTO';
import type { UpdateProductDTO } from '../../../application/dto/UpdateProductDTO';
import type { ListProductsQueryDTO, SortKey } from '../../../application/dto/ListProductsQueryDTO';
import type { ProductStatus } from '../../../../shared/types';
import { ConflictError, NotFoundError } from '../../../domain/shared/DomainError';
import { Listing } from '../../../domain/entities/Listing';
import { Money } from '../../../domain/valueObjects/Money';
import { ok, created, paginated } from '../formatters/ResponseFormatter';
import { presentListing } from '../../../application/dto/presenters';

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseStringList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
        const values = parsed.map((entry) => entry.trim()).filter(Boolean);
        return values.length ? values : undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  return csv(value);
}

function num(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseSort(value: unknown): SortKey[] | undefined {
  const tokens = csv(value);
  if (!tokens) return undefined;
  return tokens.map((token) => {
    if (token.startsWith('-')) return { field: token.slice(1), dir: 'desc' as const };
    if (token.startsWith('+')) return { field: token.slice(1), dir: 'asc' as const };
    return { field: token, dir: 'asc' as const };
  });
}

function isUniqueListingConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const pgError = err as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'unique_listing';
}

export class ProductController {
  constructor(
    private readonly products: ProductApplicationService,
    private readonly listings: ListingApplicationService,
    private readonly productAIDrafts: ProductAIDraftService,
    private readonly productRepo: IProductRepository,
    private readonly listingRepo: IListingRepository,
    private readonly marketplaceRepo: IMarketplaceRepository,
    private readonly idGenerator: () => string
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const query: ListProductsQueryDTO = {
      workspaceId: req.user!.workspaceId!,
      status: csv(req.query.status) as ProductStatus[] | undefined,
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      tags: parseStringList(req.query.tags),
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      sort: parseSort(req.query.sort),
      limit: num(req.query.limit),
      offset: num(req.query.offset),
    };
    const result = await this.products.listProducts(query);
    if (result.isErr()) return next(result.error);
    const page = result.value;
    paginated(res, page.items, {
      page: page.page,
      limit: page.limit,
      total: page.total,
      totalPages: page.totalPages,
    });
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const product = await this.products.getProduct(productId, req.user!.workspaceId!);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    ok(res, product);
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const dto: CreateProductDTO = { ...req.body, workspaceId: req.user!.workspaceId! };
    const result = await this.products.createProduct(dto);
    if (result.isErr()) return next(result.error);
    created(res, result.value);
  };

  generateAIDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.productAIDrafts.generateDraft({
      ...req.body,
      workspaceId: req.user!.workspaceId!,
    });
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    // workspaceId comes from the authenticated principal, never the body (S2).
    const dto: UpdateProductDTO = {
      ...req.body,
      productId,
      workspaceId: req.user!.workspaceId!,
    };
    const result = await this.products.updateProduct(dto);
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    const existing = await this.products.getProduct(productId, workspaceId);
    if (!existing) return next(new NotFoundError(`Product not found: ${productId}`));
    await this.productRepo.delete(productId, workspaceId);
    ok(res, { id: productId, deleted: true });
  };

  createListing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    const product = await this.productRepo.findByIdForWorkspace(productId, workspaceId);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));

    const marketplace = await this.marketplaceRepo.findByKey(
      workspaceId,
      req.body.marketplaceKey ?? 'olx'
    );
    if (!marketplace || !marketplace.isConnected()) {
      return next(new NotFoundError(`Marketplace not found: ${req.body.marketplaceKey ?? 'olx'}`));
    }

    const existing = (await this.listingRepo.findByProduct(productId)).find(
      (listing) => listing.marketplaceId === marketplace.id
    );
    if (existing) {
      return next(new ConflictError(`Listing already exists for marketplace: ${marketplace.key}`));
    }

    const money = Money.of(
      req.body.price ?? product.sellingPrice.amount,
      product.sellingPrice.currency
    );
    if (money.isErr()) return next(money.error);
    const listing = Listing.create({
      id: this.idGenerator(),
      productId: product.id,
      marketplaceId: marketplace.id,
      price: money.value,
    });
    if (listing.isErr()) return next(listing.error);

    try {
      await this.listingRepo.save(listing.value);
    } catch (err) {
      if (isUniqueListingConflict(err)) {
        return next(
          new ConflictError(`Listing already exists for marketplace: ${marketplace.key}`)
        );
      }
      return next(err);
    }
    created(res, presentListing(listing.value));
  };

  getListings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const productId = routeParam(req.params.id);
    const workspaceId = req.user!.workspaceId!;
    // Confirm the product belongs to the caller's workspace before exposing its
    // listings, otherwise a cross-tenant product id would leak listings (S2).
    const product = await this.products.getProduct(productId, workspaceId);
    if (!product) return next(new NotFoundError(`Product not found: ${productId}`));
    const listings = await this.listings.listByProduct(productId, workspaceId);
    ok(res, listings);
  };
}
