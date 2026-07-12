// Use case: update a product. Loads the aggregate once, applies only the provided
// mutations through the entity (which enforces invariants), persists a single time
// and emits one domain event. Forward-only status transitions and price/description
// bounds are guaranteed by the Product entity.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import type { Product } from '../../domain/entities/Product';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';
import { ProductValidator } from '../validators/ProductValidator';

export class UpdateProductUseCase {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly validator: ProductValidator = new ProductValidator(),
  ) {}

  async execute(input: UpdateProductDTO): Promise<Result<Product>> {
    const validated = this.validator.validateUpdate(input);
    if (validated.isErr()) return validated;
    const dto = validated.value;

    // Tenant-scoped load: a product in another workspace reads as not-found so a
    // cross-tenant id cannot be mutated (S2).
    const product = await this.productRepo.findByIdForWorkspace(
      dto.productId,
      dto.workspaceId,
    );
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${dto.productId}`));
    }

    if (dto.name !== undefined) {
      const r = product.rename(dto.name);
      if (r.isErr()) return r;
    }

    if (dto.description !== undefined) {
      const r = product.updateDescription(dto.description);
      if (r.isErr()) return r;
    }

    if (dto.sellingPrice !== undefined) {
      const currency = dto.currency ?? product.sellingPrice.currency;
      const price = Money.of(dto.sellingPrice, currency);
      if (price.isErr()) return price;
      const r = product.updateSellingPrice(price.value, dto.allowBelowCost ?? false);
      if (r.isErr()) return r;
    }

    if (dto.tags !== undefined) {
      for (const tag of [...product.tags]) product.removeTag(tag);
      for (const tag of dto.tags) {
        const r = product.addTag(tag);
        if (r.isErr()) return r;
      }
    }

    if (dto.images !== undefined) {
      product.clearImages();
      for (const url of dto.images) {
        const r = product.addImage(url);
        if (r.isErr()) return r;
      }
    }

    // Status is applied last so it cannot be undone by an earlier failure.
    if (dto.status !== undefined && dto.status !== product.status) {
      const r = product.transitionTo(dto.status);
      if (r.isErr()) return r;
    }

    await this.productRepo.save(product);

    try {
      await this.eventPublisher.publish(this.updatedEvent(product));
    } catch {
      // Product already persisted; don't fail the request over a best-effort
      // event publication failure. Consider logging/metrics here.
    }

    return Ok(product);
  }

  private updatedEvent(product: Product): DomainEvent {
    return {
      type: 'product.updated',
      aggregateType: 'Product',
      aggregateId: product.id,
      payload: { productId: product.id, workspaceId: product.workspaceId },
      occurredAt: new Date(),
    };
  }
}
