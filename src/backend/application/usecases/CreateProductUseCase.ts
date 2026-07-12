// Use case: create a product. Validate the DTO at the boundary, resolve currency
// from the workspace, build Money value objects, then delegate creation (SKU
// uniqueness, persistence and event emission) to the domain ProductService.

import { Result, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import { ProductService } from '../../domain/services/ProductService';
import type { Product } from '../../domain/entities/Product';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { IdGenerator } from '../ports/IdGenerator';
import type { CreateProductDTO } from '../dto/CreateProductDTO';
import { ProductValidator } from '../validators/ProductValidator';

export class CreateProductUseCase {
  constructor(
    private readonly productService: ProductService,
    private readonly workspaceRepo: IWorkspaceRepository,
    private readonly idGenerator: IdGenerator,
    private readonly validator: ProductValidator = new ProductValidator(),
  ) {}

  async execute(input: CreateProductDTO): Promise<Result<Product>> {
    const validated = this.validator.validateCreate(input);
    if (validated.isErr()) return validated;
    const dto = validated.value;

    const workspace = await this.workspaceRepo.findById(dto.workspaceId);
    if (!workspace) {
      return Err(new NotFoundError(`Workspace not found: ${dto.workspaceId}`));
    }

    const currency = dto.currency ?? workspace.currency;

    const costPrice = Money.of(dto.costPrice, currency);
    if (costPrice.isErr()) return costPrice;
    const sellingPrice = Money.of(dto.sellingPrice, currency);
    if (sellingPrice.isErr()) return sellingPrice;

    return this.productService.createProduct({
      id: this.idGenerator(),
      workspaceId: dto.workspaceId,
      sku: dto.sku,
      name: dto.name,
      description: dto.description,
      costPrice: costPrice.value,
      sellingPrice: sellingPrice.value,
      condition: dto.condition,
      category: dto.category,
      tags: dto.tags,
      images: dto.images,
      allowBelowCost: dto.allowBelowCost,
    });
  }
}
