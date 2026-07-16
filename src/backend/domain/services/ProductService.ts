// Domain service orchestrating Product lifecycle. Enforces invariants via the
// Product entity and emits domain events through the IEventPublisher port.

import { Result, Ok, Err } from '../shared/Result';
import { ConflictError, NotFoundError } from '../shared/DomainError';
import { Product } from '../entities/Product';
import { Money } from '../valueObjects/Money';
import { buildPricingDecision } from './pricingDecision';
import type { ProductStatus, ProductCondition } from '../../../shared/types';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';

export interface CreateProductCommand {
  id: string;
  workspaceId: string;
  sku: string;
  name: string;
  description: string;
  costPrice: Money;
  sellingPrice: Money;
  condition: ProductCondition;
  category: string;
  tags?: string[];
  images?: string[];
  allowBelowCost?: boolean;
}

export class ProductService {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly eventPublisher: IEventPublisher,
  ) {}

  async createProduct(command: CreateProductCommand): Promise<Result<Product>> {
    const created = Product.create(command);
    if (created.isErr()) return created;
    const product = created.value;

    const existing = await this.productRepo.findBySku(
      command.workspaceId,
      command.sku,
    );
    if (existing) {
      return Err(new ConflictError(`SKU already exists: ${command.sku}`));
    }

    await this.productRepo.save(product);
    await this.publish('product.created', product.id, {
      productId: product.id,
      workspaceId: product.workspaceId,
      sku: product.sku,
      name: product.name,
      pricingDecision: buildPricingDecision(product, command.allowBelowCost === true),
    });

    return Ok(product);
  }

  async updateSellingPrice(
    productId: string,
    newPrice: Money,
    allowBelowCost = false,
  ): Promise<Result<Product>> {
    const product = await this.productRepo.findById(productId);
    if (!product) return Err(new NotFoundError(`Product not found: ${productId}`));

    const oldPrice = product.sellingPrice.amount;
    const updated = product.updateSellingPrice(newPrice, allowBelowCost);
    if (updated.isErr()) return updated;

    await this.productRepo.save(product);
    await this.publish('product.price_changed', product.id, {
      productId: product.id,
      workspaceId: product.workspaceId,
      oldPrice,
      newPrice: product.sellingPrice.amount,
      pricingDecision: buildPricingDecision(product, allowBelowCost, {
          costPrice: product.costPrice?.amount ?? null,
          sellingPrice: oldPrice,
      }),
    });

    return Ok(product);
  }

  async updateDescription(
    productId: string,
    description: string,
  ): Promise<Result<Product>> {
    const product = await this.productRepo.findById(productId);
    if (!product) return Err(new NotFoundError(`Product not found: ${productId}`));

    const updated = product.updateDescription(description);
    if (updated.isErr()) return updated;

    await this.productRepo.save(product);
    await this.publish('product.updated', product.id, {
      productId: product.id,
      workspaceId: product.workspaceId,
      field: 'description',
    });

    return Ok(product);
  }

  async changeStatus(
    productId: string,
    next: ProductStatus,
  ): Promise<Result<Product>> {
    const product = await this.productRepo.findById(productId);
    if (!product) return Err(new NotFoundError(`Product not found: ${productId}`));

    const transitioned = product.transitionTo(next);
    if (transitioned.isErr()) return transitioned;

    await this.productRepo.save(product);
    await this.publish('product.status_changed', product.id, {
      productId: product.id,
      workspaceId: product.workspaceId,
      status: product.status,
    });

    return Ok(product);
  }

  private async publish(
    type: string,
    productId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: DomainEvent = {
      type,
      aggregateType: 'Product',
      aggregateId: productId,
      payload,
      occurredAt: new Date(),
    };
    await this.eventPublisher.publish(event);
  }
}
