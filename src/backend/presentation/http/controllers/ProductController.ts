// Thin HTTP adapter for product resources. Parses the request, derives the tenant
// (workspaceId) from the authenticated principal, delegates to the application
// service, and translates the Result via ResponseFormatter. No business logic here.

import type { Request, Response, NextFunction } from 'express';
import type { ProductApplicationService } from '../../../application/services/ProductApplicationService';
import type { ListingApplicationService } from '../../../application/services/ListingApplicationService';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { CreateProductDTO } from '../../../application/dto/CreateProductDTO';
import type { UpdateProductDTO } from '../../../application/dto/UpdateProductDTO';
import type {
  ListProductsQueryDTO,
  SortKey,
} from '../../../application/dto/ListProductsQueryDTO';
import type { ProductStatus } from '../../../../shared/types';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { ok, created, paginated } from '../formatters/ResponseFormatter';

function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

export class ProductController {
  constructor(
    private readonly products: ProductApplicationService,
    private readonly listings: ListingApplicationService,
    private readonly productRepo: IProductRepository,
  ) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const query: ListProductsQueryDTO = {
      workspaceId: req.user!.workspaceId!,
      status: csv(req.query.status) as ProductStatus[] | undefined,
      priceMin: num(req.query.priceMin),
      priceMax: num(req.query.priceMax),
      tags: csv(req.query.tags),
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
    const product = await this.products.getProduct(
      req.params.id,
      req.user!.workspaceId!,
    );
    if (!product) return next(new NotFoundError(`Product not found: ${req.params.id}`));
    ok(res, product);
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const dto: CreateProductDTO = { ...req.body, workspaceId: req.user!.workspaceId! };
    const result = await this.products.createProduct(dto);
    if (result.isErr()) return next(result.error);
    created(res, result.value);
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // workspaceId comes from the authenticated principal, never the body (S2).
    const dto: UpdateProductDTO = {
      ...req.body,
      productId: req.params.id,
      workspaceId: req.user!.workspaceId!,
    };
    const result = await this.products.updateProduct(dto);
    if (result.isErr()) return next(result.error);
    ok(res, result.value);
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const workspaceId = req.user!.workspaceId!;
    const existing = await this.products.getProduct(req.params.id, workspaceId);
    if (!existing) return next(new NotFoundError(`Product not found: ${req.params.id}`));
    await this.productRepo.delete(req.params.id, workspaceId);
    ok(res, { id: req.params.id, deleted: true });
  };

  getListings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Confirm the product belongs to the caller's workspace before exposing its
    // listings, otherwise a cross-tenant product id would leak listings (S2).
    const product = await this.products.getProduct(
      req.params.id,
      req.user!.workspaceId!,
    );
    if (!product) return next(new NotFoundError(`Product not found: ${req.params.id}`));
    const listings = await this.listings.listByProduct(req.params.id);
    ok(res, listings);
  };
}
