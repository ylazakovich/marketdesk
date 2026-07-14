// Product aggregate root. Enforces the invariants from ARCHITECTURE.md §3:
//   - sellingPrice >= 0 (selling below cost is allowed but surfaced as a warning upstream)
//   - description length in [20, 2000]
//   - status transitions are forward-only: draft -> active -> attention -> sold

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError, InvalidStateError } from '../shared/DomainError';
import { Money } from '../valueObjects/Money';
import type { ProductStatus, ProductCondition } from '../../../shared/types';
import {
  PRODUCT_DESCRIPTION_MIN_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
} from '../../../shared/constants';

const STATUS_ORDER: ProductStatus[] = ['draft', 'active', 'attention', 'sold'];

export interface CreateProductProps {
  id: string;
  workspaceId: string;
  sku: string;
  name: string;
  description: string;
  costPrice: Money;
  sellingPrice: Money;
  condition: ProductCondition;
  category: string;
  status?: ProductStatus;
  tags?: string[];
  images?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  // Backwards-compatible API flag; below-cost selling is now always allowed.
  allowBelowCost?: boolean;
}

export class Product {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly sku: string,
    private _name: string,
    private _description: string,
    private _costPrice: Money,
    private _sellingPrice: Money,
    private _condition: ProductCondition,
    private _category: string,
    private _status: ProductStatus,
    private _tags: string[],
    private _images: string[],
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(props: CreateProductProps): Result<Product> {
    if (!props.id?.trim()) {
      return Err(new ValidationError('Product id is required'));
    }
    if (!props.workspaceId?.trim()) {
      return Err(new ValidationError('Product workspaceId is required'));
    }
    if (!props.sku?.trim()) {
      return Err(new ValidationError('Product sku is required'));
    }
    if (!props.name?.trim()) {
      return Err(new ValidationError('Product name is required'));
    }
    if (!props.category?.trim()) {
      return Err(new ValidationError('Product category is required'));
    }

    const descriptionCheck = Product.validateDescription(props.description);
    if (descriptionCheck.isErr()) return descriptionCheck;

    if (props.costPrice.isNegative()) {
      return Err(new ValidationError('costPrice must be >= 0'));
    }
    if (props.sellingPrice.isNegative()) {
      return Err(new ValidationError('sellingPrice must be >= 0'));
    }
    if (props.costPrice.currency !== props.sellingPrice.currency) {
      return Err(
        new ValidationError('costPrice and sellingPrice must share a currency'),
      );
    }
    const now = new Date();
    return Ok(
      new Product(
        props.id,
        props.workspaceId,
        props.sku,
        props.name.trim(),
        props.description,
        props.costPrice,
        props.sellingPrice,
        props.condition,
        props.category,
        props.status ?? 'draft',
        props.tags ? [...props.tags] : [],
        props.images ? [...props.images] : [],
        props.createdAt ?? now,
        props.updatedAt ?? now,
      ),
    );
  }

  // Rehydrate from persistence without re-running invariants (data is trusted).
  static reconstitute(props: Required<Omit<CreateProductProps, 'allowBelowCost'>>): Product {
    return new Product(
      props.id,
      props.workspaceId,
      props.sku,
      props.name,
      props.description,
      props.costPrice,
      props.sellingPrice,
      props.condition,
      props.category,
      props.status,
      [...props.tags],
      [...props.images],
      props.createdAt,
      props.updatedAt,
    );
  }

  private static validateDescription(description: string): Result<true> {
    const len = description?.length ?? 0;
    if (len < PRODUCT_DESCRIPTION_MIN_LENGTH || len > PRODUCT_DESCRIPTION_MAX_LENGTH) {
      return Err(
        new ValidationError(
          `description length must be between ${PRODUCT_DESCRIPTION_MIN_LENGTH} and ${PRODUCT_DESCRIPTION_MAX_LENGTH}`,
        ),
      );
    }
    return Ok(true);
  }

  // --- Getters ---
  get name(): string {
    return this._name;
  }
  get description(): string {
    return this._description;
  }
  get costPrice(): Money {
    return this._costPrice;
  }
  get sellingPrice(): Money {
    return this._sellingPrice;
  }
  get condition(): ProductCondition {
    return this._condition;
  }
  get category(): string {
    return this._category;
  }
  get status(): ProductStatus {
    return this._status;
  }
  get tags(): readonly string[] {
    return this._tags;
  }
  get images(): readonly string[] {
    return this._images;
  }
  get imageCount(): number {
    return this._images.length;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  // --- Behavior ---

  // A product can back a live listing only while it has not been sold.
  canPublish(): boolean {
    return this._status !== 'sold';
  }

  isSold(): boolean {
    return this._status === 'sold';
  }

  transitionTo(next: ProductStatus): Result<void> {
    const from = STATUS_ORDER.indexOf(this._status);
    const to = STATUS_ORDER.indexOf(next);
    if (to < 0) {
      return Err(new ValidationError(`Unknown product status: ${next}`));
    }
    if (to <= from) {
      return Err(
        new InvalidStateError(
          `Illegal product status transition ${this._status} -> ${next} (forward-only)`,
        ),
      );
    }
    this._status = next;
    this.touch();
    return Ok(undefined);
  }

  activate(): Result<void> {
    return this.transitionTo('active');
  }

  flagAttention(): Result<void> {
    return this.transitionTo('attention');
  }

  markSold(): Result<void> {
    return this.transitionTo('sold');
  }

  updateSellingPrice(price: Money, _allowBelowCost = false): Result<void> {
    if (price.isNegative()) {
      return Err(new ValidationError('sellingPrice must be >= 0'));
    }
    if (price.currency !== this._costPrice.currency) {
      return Err(new ValidationError('sellingPrice currency must match costPrice'));
    }
    this._sellingPrice = price;
    this.touch();
    return Ok(undefined);
  }

  updateDescription(description: string): Result<void> {
    const check = Product.validateDescription(description);
    if (check.isErr()) return check;
    this._description = description;
    this.touch();
    return Ok(undefined);
  }

  rename(name: string): Result<void> {
    if (!name?.trim()) {
      return Err(new ValidationError('Product name is required'));
    }
    this._name = name.trim();
    this.touch();
    return Ok(undefined);
  }

  addTag(tag: string): Result<void> {
    const t = tag?.trim();
    if (!t) return Err(new ValidationError('Tag cannot be empty'));
    if (!this._tags.includes(t)) {
      this._tags.push(t);
      this.touch();
    }
    return Ok(undefined);
  }

  removeTag(tag: string): void {
    const idx = this._tags.indexOf(tag);
    if (idx >= 0) {
      this._tags.splice(idx, 1);
      this.touch();
    }
  }

  addImage(url: string): Result<void> {
    const u = url?.trim();
    if (!u) return Err(new ValidationError('Image url cannot be empty'));
    this._images.push(u);
    this.touch();
    return Ok(undefined);
  }

  clearImages(): void {
    this._images = [];
    this.touch();
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
