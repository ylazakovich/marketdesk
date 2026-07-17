// Product aggregate root. Enforces the invariants from ARCHITECTURE.md §3:
//   - sellingPrice >= 0; below-cost pricing requires an explicit caller confirmation
//   - description length in [20, 2000]
//   - status transitions are forward-only: draft -> active -> attention -> sold

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError, InvalidStateError } from '../shared/DomainError';
import { Money } from '../valueObjects/Money';
import type {
  ProductStatus,
  ProductCondition,
  ProductCategoryProvenance,
  ProductCategorySource,
} from '../../../shared/types';
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
  costPrice: Money | null;
  sellingPrice: Money;
  condition: ProductCondition;
  category: string;
  status?: ProductStatus;
  tags?: string[];
  images?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  // Explicit confirmation required when sellingPrice is below costPrice.
  allowBelowCost?: boolean;
}

export class Product {
  private constructor(
    public readonly id: string,
    public readonly workspaceId: string,
    public readonly sku: string,
    private _name: string,
    private _description: string,
    private _costPrice: Money | null,
    private _sellingPrice: Money,
    private _condition: ProductCondition,
    private _category: string,
    private _categoryProvenance: ProductCategoryProvenance | null,
    private _status: ProductStatus,
    private _tags: string[],
    private _images: string[],
    public readonly createdAt: Date,
    private _updatedAt: Date,
    private _categoryStateDirty: boolean,
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

    if (props.costPrice && props.costPrice.isNegative()) {
      return Err(new ValidationError('costPrice must be >= 0'));
    }
    if (props.sellingPrice.isNegative()) {
      return Err(new ValidationError('sellingPrice must be >= 0'));
    }
    if (props.costPrice && props.costPrice.currency !== props.sellingPrice.currency) {
      return Err(new ValidationError('costPrice and sellingPrice must share a currency'));
    }
    if (props.costPrice?.isGreaterThan(props.sellingPrice) && props.allowBelowCost !== true) {
      return Err(new ValidationError('sellingPrice below costPrice requires allowBelowCost: true'));
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
        null,
        props.status ?? 'draft',
        props.tags ? [...props.tags] : [],
        props.images ? [...props.images] : [],
        props.createdAt ?? now,
        props.updatedAt ?? now,
        true,
      )
    );
  }

  // Rehydrate from persistence without re-running invariants (data is trusted).
  static reconstitute(
    props: Required<Omit<CreateProductProps, 'allowBelowCost'>>
      & { categoryProvenance?: ProductCategoryProvenance | null }
  ): Product {
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
      props.categoryProvenance ?? null,
      props.status,
      [...props.tags],
      [...props.images],
      props.createdAt,
      props.updatedAt,
      false,
    );
  }

  private static validateDescription(description: string): Result<true> {
    const len = description?.length ?? 0;
    if (len < PRODUCT_DESCRIPTION_MIN_LENGTH || len > PRODUCT_DESCRIPTION_MAX_LENGTH) {
      return Err(
        new ValidationError(
          `description length must be between ${PRODUCT_DESCRIPTION_MIN_LENGTH} and ${PRODUCT_DESCRIPTION_MAX_LENGTH}`
        )
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
  get costPrice(): Money | null {
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
  get categoryProvenance(): ProductCategoryProvenance | null {
    return this._categoryProvenance ? structuredClone(this._categoryProvenance) : null;
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
  get hasCategoryStateChanges(): boolean {
    return this._categoryStateDirty;
  }

  markCategoryStatePersisted(): void {
    this._categoryStateDirty = false;
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
          `Illegal product status transition ${this._status} -> ${next} (forward-only)`
        )
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

  updateSellingPrice(price: Money, allowBelowCost = false): Result<void> {
    if (price.isNegative()) {
      return Err(new ValidationError('sellingPrice must be >= 0'));
    }
    if (this._costPrice && price.currency !== this._costPrice.currency) {
      return Err(new ValidationError('sellingPrice currency must match costPrice'));
    }
    if (this._costPrice?.isGreaterThan(price) && !allowBelowCost) {
      return Err(new ValidationError('sellingPrice below costPrice requires allowBelowCost: true'));
    }
    this._sellingPrice = price;
    this.touch();
    return Ok(undefined);
  }

  updateCostPrice(price: Money, allowBelowCost = false): Result<void> {
    if (price.isNegative()) {
      return Err(new ValidationError('costPrice must be >= 0'));
    }
    if (price.currency !== this._sellingPrice.currency) {
      return Err(new ValidationError('costPrice currency must match sellingPrice'));
    }
    if (price.isGreaterThan(this._sellingPrice) && !allowBelowCost) {
      return Err(new ValidationError('sellingPrice below costPrice requires allowBelowCost: true'));
    }
    this._costPrice = price;
    this.touch();
    return Ok(undefined);
  }

  clearCostPrice(): void {
    this._costPrice = null;
    this.touch();
  }

  // Applies coordinated price changes atomically so callers do not need to know
  // which update order avoids transient cost/selling invariant failures.
  updatePrices(
    costPrice: Money | null,
    sellingPrice: Money | null,
    allowBelowCost = false
  ): Result<void> {
    if (!costPrice && !sellingPrice) return Ok(undefined);
    const nextCost = costPrice ?? this._costPrice;
    const nextSelling = sellingPrice ?? this._sellingPrice;

    if (nextCost && nextCost.isNegative()) {
      return Err(new ValidationError('costPrice must be >= 0'));
    }
    if (nextSelling.isNegative()) {
      return Err(new ValidationError('sellingPrice must be >= 0'));
    }
    if (nextCost && nextCost.currency !== nextSelling.currency) {
      return Err(new ValidationError('costPrice and sellingPrice must share a currency'));
    }
    if (nextCost?.isGreaterThan(nextSelling) && !allowBelowCost) {
      return Err(new ValidationError('sellingPrice below costPrice requires allowBelowCost: true'));
    }

    if (costPrice) this._costPrice = costPrice;
    if (sellingPrice) this._sellingPrice = sellingPrice;
    if (costPrice || sellingPrice) this.touch();
    return Ok(undefined);
  }

  updateCondition(condition: ProductCondition): Result<void> {
    this._condition = condition;
    this.touch();
    return Ok(undefined);
  }

  updateCategory(category: string): Result<void> {
    if (!category?.trim()) {
      return Err(new ValidationError('Product category is required'));
    }
    const normalized = category.trim();
    if (normalized === this._category) return Ok(undefined);
    this._category = normalized;
    this._categoryProvenance = null;
    this._categoryStateDirty = true;
    this.touch();
    return Ok(undefined);
  }

  synchronizeCategory(
    category: string,
    sources: ProductCategorySource[],
  ): Result<{ categoryChanged: boolean; stateChanged: boolean }> {
    const normalized = category?.trim();
    if (!normalized) return Err(new ValidationError('Product category is required'));
    const normalizedSources = Product.sortedSources(sources);
    if (normalizedSources.length === 0) {
      return Err(new ValidationError('At least one category source is required'));
    }
    const current = this._categoryProvenance;
    const sameSources = current?.status === 'synced'
      && Product.sameSourceState(current.sources, normalizedSources);
    const categoryChanged = this._category !== normalized;
    if (!categoryChanged && sameSources) {
      return Ok({ categoryChanged: false, stateChanged: false });
    }
    this._category = normalized;
    this._categoryProvenance = { status: 'synced', sources: normalizedSources };
    this._categoryStateDirty = true;
    this.touch();
    return Ok({ categoryChanged, stateChanged: true });
  }

  recordCategoryConflict(
    candidates: ProductCategorySource[],
    detectedAt: Date = new Date(),
  ): { stateChanged: boolean; conflictChanged: boolean } {
    const normalized = Product.sortedSources(candidates);
    const current = this._categoryProvenance;
    if (current?.status === 'conflict' && Product.sameCandidateSet(current.candidates, normalized)) {
      const refreshedCurrentSources = current.currentSources?.map((source) => {
        const refreshed = normalized.find(
          (candidate) => Product.categorySourceKey(candidate) === Product.categorySourceKey(source),
        );
        return refreshed ?? source;
      }) ?? null;
      const candidatesChanged = !Product.sameSourceState(current.candidates, normalized);
      const currentSourcesChanged = current.currentSources !== null
        && !Product.sameSourceState(current.currentSources, refreshedCurrentSources ?? []);
      if (!candidatesChanged && !currentSourcesChanged) {
        return { stateChanged: false, conflictChanged: false };
      }
      this._categoryProvenance = {
        ...current,
        currentSources: refreshedCurrentSources,
        candidates: normalized,
      };
      this._categoryStateDirty = true;
      this.touch();
      return { stateChanged: true, conflictChanged: false };
    }
    this._categoryProvenance = {
      status: 'conflict',
      currentSources: current?.status === 'synced'
        ? Product.sortedSources(current.sources)
        : (current?.currentSources ?? null),
      candidates: normalized,
      detectedAt: detectedAt.toISOString(),
    };
    this._categoryStateDirty = true;
    this.touch();
    return { stateChanged: true, conflictChanged: true };
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

  private static categorySourceKey(source: ProductCategorySource): string {
    return [
      source.marketplaceKey,
      source.marketplaceId,
      source.listingId,
      source.providerCategoryId,
      source.name,
      ...source.path,
    ].join('\u0000');
  }

  private static sortedSources(sources: ProductCategorySource[]): ProductCategorySource[] {
    return [...sources]
      .map((source) => structuredClone(source))
      .sort((left, right) => Product.categorySourceKey(left).localeCompare(Product.categorySourceKey(right)));
  }

  private static sameCandidateSet(
    left: ProductCategorySource[],
    right: ProductCategorySource[],
  ): boolean {
    const keys = (values: ProductCategorySource[]) => values
      .map(Product.categorySourceKey)
      .sort();
    return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
  }

  private static sameSourceState(
    left: ProductCategorySource[],
    right: ProductCategorySource[],
  ): boolean {
    const keys = (values: ProductCategorySource[]) => values
      .map((source) => [
        Product.categorySourceKey(source),
        source.taxonomyVerifiedAt,
        source.syncedAt,
      ].join('\u0000'))
      .sort();
    return JSON.stringify(keys(left)) === JSON.stringify(keys(right));
  }
}
