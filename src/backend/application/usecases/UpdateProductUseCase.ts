// Use case: update a product. Loads the aggregate once, applies only the provided
// mutations through the entity (which enforces invariants), persists a single time
// and emits one domain event. Forward-only status transitions and price/description
// bounds are guaranteed by the Product entity.

import { Result, Ok, Err } from '../../domain/shared/Result';
import { NotFoundError } from '../../domain/shared/DomainError';
import { Money } from '../../domain/valueObjects/Money';
import { Product } from '../../domain/entities/Product';
import { buildPricingDecision } from '../../domain/services/pricingDecision';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IEventPublisher, DomainEvent } from '../../domain/ports/IEventPublisher';
import type { UpdateProductDTO } from '../dto/UpdateProductDTO';
import { ProductValidator } from '../validators/ProductValidator';

export class UpdateProductUseCase {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly eventPublisher: IEventPublisher,
    private readonly validator: ProductValidator = new ProductValidator()
  ) {}

  async execute(input: UpdateProductDTO): Promise<Result<Product>> {
    const validated = this.validator.validateUpdate(input);
    if (validated.isErr()) return validated;
    const dto = validated.value;

    // Tenant-scoped load: a product in another workspace reads as not-found so a
    // cross-tenant id cannot be mutated (S2).
    const product = await this.productRepo.findByIdForWorkspace(dto.productId, dto.workspaceId);
    if (!product) {
      return Err(new NotFoundError(`Product not found: ${dto.productId}`));
    }
    const previousCostPrice = product.costPrice?.amount ?? null;
    const previousSellingPrice = product.sellingPrice.amount;

    if (dto.name !== undefined) {
      const r = product.rename(dto.name);
      if (r.isErr()) return r;
    }

    if (dto.description !== undefined) {
      const r = product.updateDescription(dto.description);
      if (r.isErr()) return r;
    }

    let clearCostPrice = false;
    let nextCostPrice: Money | null = null;
    if (dto.costPrice !== undefined) {
      if (dto.costPrice === null) {
        clearCostPrice = true;
      } else {
        const price = Money.of(
          dto.costPrice,
          dto.currency ?? product.costPrice?.currency ?? product.sellingPrice.currency
        );
        if (price.isErr()) return price;
        nextCostPrice = price.value;
      }
    }

    let nextSellingPrice: Money | null = null;
    if (dto.sellingPrice !== undefined) {
      const price = Money.of(dto.sellingPrice, dto.currency ?? product.sellingPrice.currency);
      if (price.isErr()) return price;
      nextSellingPrice = price.value;
    }

    const priceUpdate = product.updatePrices(
      nextCostPrice,
      nextSellingPrice,
      dto.allowBelowCost ?? false
    );
    if (priceUpdate.isErr()) return priceUpdate;
    if (clearCostPrice) product.clearCostPrice();

    if (dto.condition !== undefined) {
      const r = product.updateCondition(dto.condition);
      if (r.isErr()) return r;
    }

    if (dto.category !== undefined) {
      const r = product.updateCategory(dto.category);
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
      await this.eventPublisher.publish(
        this.updatedEvent(product, {
          pricesChanged: dto.costPrice !== undefined || dto.sellingPrice !== undefined,
          belowCostConfirmed: dto.allowBelowCost === true,
          previousCostPrice,
          previousSellingPrice,
        })
      );
    } catch {
      // Product already persisted; don't fail the request over a best-effort
      // event publication failure. Consider logging/metrics here.
    }

    return Ok(product);
  }

  private updatedEvent(
    product: Product,
    pricing: {
      pricesChanged: boolean;
      belowCostConfirmed: boolean;
      previousCostPrice: number | null;
      previousSellingPrice: number;
    }
  ): DomainEvent {
    const payload: Record<string, unknown> = {
      productId: product.id,
      workspaceId: product.workspaceId,
    };
    if (pricing.pricesChanged) {
      payload.pricingDecision = buildPricingDecision(product, pricing.belowCostConfirmed, {
          costPrice: pricing.previousCostPrice,
          sellingPrice: pricing.previousSellingPrice,
      });
    }
    return {
      type: 'product.updated',
      aggregateType: 'Product',
      aggregateId: product.id,
      payload,
      occurredAt: new Date(),
    };
  }
}
