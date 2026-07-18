// Application service (facade) for product workflows. Groups the create/update use
// cases and exposes paginated read/query methods for controllers (Group 5). Write
// methods return presented views; queries apply §18 filtering + multi-key sorting in
// memory over the workspace's products.

import { Result, Ok } from '../../domain/shared/Result';
import type { Product } from '../../domain/entities/Product';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { PaginatedResponse } from '../../../shared/types';
import { CreateProductUseCase } from '../usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../usecases/UpdateProductUseCase';
import { PricingValidator } from '../validators/PricingValidator';
import type { CreateProductDTO } from '../dto/CreateProductDTO';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';
import type { ListProductsQueryDTO, SortKey } from '../dto/ListProductsQueryDTO';
import { presentProduct, type ProductView } from '../dto/presenters';
import { normalizeLimit, normalizeOffset, paginate } from '../dto/pagination';

export class ProductApplicationService {
  private readonly pricingValidator = new PricingValidator();

  constructor(
    private readonly productRepo: IProductRepository,
    private readonly createProductUseCase: CreateProductUseCase,
    private readonly updateProductUseCase: UpdateProductUseCase
  ) {}

  async createProduct(dto: CreateProductDTO): Promise<Result<ProductView>> {
    const result = await this.createProductUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentProduct(result.value));
  }

  async updateProduct(dto: UpdateProductDTO): Promise<Result<ProductView>> {
    const result = await this.updateProductUseCase.execute(dto);
    return result.isErr() ? result : Ok(presentProduct(result.value));
  }

  async getProduct(id: string, workspaceId: string): Promise<ProductView | null> {
    // Tenant-scoped so a cross-workspace id reads as not-found (S2).
    const product = await this.productRepo.findByIdForWorkspace(id, workspaceId);
    return product ? presentProduct(product) : null;
  }

  async listProducts(query: ListProductsQueryDTO): Promise<Result<PaginatedResponse<ProductView>>> {
    const validated = this.pricingValidator.validateListQuery(query);
    if (validated.isErr()) return validated;
    const q = validated.value;

    const all = await this.productRepo.findByWorkspace(q.workspaceId);
    const filtered = all.filter((p) => this.matches(p, q));
    const sorted = this.sort(filtered, q.sort);

    const limit = normalizeLimit(q.limit);
    const offset = normalizeOffset(q.offset);
    return Ok(paginate(sorted, offset, limit, presentProduct));
  }

  private matches(product: Product, q: ListProductsQueryDTO): boolean {
    if (q.status && q.status.length > 0 && !q.status.includes(product.status)) {
      return false;
    }
    const price = product.sellingPrice.amount;
    if (q.priceMin !== undefined && price < q.priceMin) return false;
    if (q.priceMax !== undefined && price > q.priceMax) return false;
    if (q.tags && q.tags.length > 0) {
      const has = q.tags.some((t) => product.tags.includes(t));
      if (!has) return false;
    }
    if (q.search) {
      const needle = q.search.toLowerCase();
      const haystack =
        `${product.name} ${product.sku} ${product.description} ${product.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  private sort(products: Product[], sort?: SortKey[]): Product[] {
    if (!sort || sort.length === 0) {
      return [...products].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }
    return [...products].sort((a, b) => {
      for (const key of sort) {
        const cmp = this.compareField(a, b, key.field);
        if (cmp !== 0) return key.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }

  private compareField(a: Product, b: Product, field: string): number {
    switch (field) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'sku':
        return a.sku.localeCompare(b.sku);
      case 'sellingPrice':
        return a.sellingPrice.minorUnits - b.sellingPrice.minorUnits;
      case 'costPrice':
        return (
          (a.costPrice?.minorUnits ?? Number.POSITIVE_INFINITY) -
          (b.costPrice?.minorUnits ?? Number.POSITIVE_INFINITY)
        );
      case 'status':
        return a.status.localeCompare(b.status);
      case 'createdAt':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'updatedAt':
      default:
        return a.updatedAt.getTime() - b.updatedAt.getTime();
    }
  }
}
