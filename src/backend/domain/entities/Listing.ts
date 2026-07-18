// Listing entity (child of Product). Invariants per ARCHITECTURE.md §3:
//   - price must be set before publish
//   - status = live only if the product is not sold
//   - marketplace must be connected to publish

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError, InvalidStateError } from '../shared/DomainError';
import { Money } from '../valueObjects/Money';
import { canTransition } from '../valueObjects/ListingStatus';
import type { ListingStatus, MarketplaceCategoryMetadata } from '../../../shared/types';
import type { Product } from './Product';
import type { Marketplace } from './Marketplace';

export interface CreateListingProps {
  id: string;
  productId: string;
  marketplaceId: string;
  price: Money;
  marketplaceListingId?: string | null;
  externalUrl?: string | null;
  status?: ListingStatus;
  remoteStatus?: string | null;
  marketplaceCategory?: MarketplaceCategoryMetadata | null;
  views?: number | null;
  watchers?: number | null;
  messages?: number | null;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  syncError?: string | null;
  lastSyncAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Listing {
  private constructor(
    public readonly id: string,
    public readonly productId: string,
    public readonly marketplaceId: string,
    private _price: Money,
    private _marketplaceListingId: string | null,
    private _externalUrl: string | null,
    private _status: ListingStatus,
    private _remoteStatus: string | null,
    private _marketplaceCategory: MarketplaceCategoryMetadata | null,
    private _views: number | null,
    private _watchers: number | null,
    private _messages: number | null,
    private _publishedAt: Date | null,
    private _expiresAt: Date | null,
    private _syncError: string | null,
    private _lastSyncAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date
  ) {}

  static create(props: CreateListingProps): Result<Listing> {
    if (!props.id?.trim()) {
      return Err(new ValidationError('Listing id is required'));
    }
    if (!props.productId?.trim()) {
      return Err(new ValidationError('Listing productId is required'));
    }
    if (!props.marketplaceId?.trim()) {
      return Err(new ValidationError('Listing marketplaceId is required'));
    }
    if (props.price.isNegative()) {
      return Err(new ValidationError('Listing price must be >= 0'));
    }

    const now = new Date();
    return Ok(
      new Listing(
        props.id,
        props.productId,
        props.marketplaceId,
        props.price,
        props.marketplaceListingId ?? null,
        props.externalUrl ?? null,
        props.status ?? 'draft',
        props.remoteStatus ?? null,
        props.marketplaceCategory ?? null,
        props.views ?? null,
        props.watchers ?? null,
        props.messages ?? null,
        props.publishedAt ?? null,
        props.expiresAt ?? null,
        props.syncError ?? null,
        props.lastSyncAt ?? null,
        props.createdAt ?? now,
        props.updatedAt ?? now
      )
    );
  }

  static reconstitute(props: Required<CreateListingProps>): Listing {
    return new Listing(
      props.id,
      props.productId,
      props.marketplaceId,
      props.price,
      props.marketplaceListingId,
      props.externalUrl,
      props.status,
      props.remoteStatus,
      props.marketplaceCategory,
      props.views,
      props.watchers,
      props.messages,
      props.publishedAt,
      props.expiresAt,
      props.syncError,
      props.lastSyncAt,
      props.createdAt,
      props.updatedAt
    );
  }

  // --- Getters ---
  get price(): Money {
    return this._price;
  }
  get status(): ListingStatus {
    return this._status;
  }
  get remoteStatus(): string | null {
    return this._remoteStatus;
  }
  get marketplaceCategory(): MarketplaceCategoryMetadata | null {
    return this._marketplaceCategory;
  }
  get marketplaceListingId(): string | null {
    return this._marketplaceListingId;
  }
  get externalUrl(): string | null {
    return this._externalUrl;
  }
  get views(): number | null {
    return this._views;
  }
  get watchers(): number | null {
    return this._watchers;
  }
  get messages(): number | null {
    return this._messages;
  }
  get publishedAt(): Date | null {
    return this._publishedAt;
  }
  get expiresAt(): Date | null {
    return this._expiresAt;
  }
  get syncError(): string | null {
    return this._syncError;
  }
  get lastSyncAt(): Date | null {
    return this._lastSyncAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  // --- Behavior ---
  isLive(): boolean {
    return this._status === 'live';
  }

  isExpired(now: Date = new Date()): boolean {
    if (this._status === 'expired') return true;
    return this._expiresAt !== null && this._expiresAt.getTime() < now.getTime();
  }

  updatePrice(price: Money): Result<void> {
    if (price.isNegative()) {
      return Err(new ValidationError('Listing price must be >= 0'));
    }
    this._price = price;
    this.touch();
    return Ok(undefined);
  }

  // Publish this listing to a connected marketplace for a non-sold product.
  publish(
    product: Product,
    marketplace: Marketplace,
    externalListingId: string,
    externalUrl: string | null = null,
    publishedAt: Date = new Date(),
    expiresAt: Date | null = null,
    remoteStatus: string | null = null
  ): Result<void> {
    if (this._price.isZero() && this._status === 'draft') {
      // price must be set before publish (treat zero as "not set" for publish)
      return Err(new InvalidStateError('Listing price must be set before publish'));
    }
    if (!marketplace.isConnected()) {
      return Err(new InvalidStateError('Marketplace must be connected to publish a listing'));
    }
    if (!product.canPublish()) {
      return Err(new InvalidStateError('Cannot publish a listing for a sold product'));
    }
    if (!externalListingId?.trim()) {
      return Err(new ValidationError('externalListingId is required to publish'));
    }
    if (!canTransition(this._status, 'live')) {
      return Err(new InvalidStateError(`Cannot publish from status ${this._status}`));
    }

    this._status = 'live';
    this._marketplaceListingId = externalListingId;
    this._externalUrl = externalUrl;
    this._publishedAt = publishedAt;
    this._expiresAt = expiresAt;
    this._remoteStatus = remoteStatus;
    this._syncError = null;
    this.touch();
    return Ok(undefined);
  }

  relist(publishedAt: Date = new Date(), expiresAt: Date | null = null): Result<void> {
    if (!canTransition(this._status, 'live')) {
      return Err(new InvalidStateError(`Cannot relist from status ${this._status}`));
    }
    this._status = 'live';
    this._publishedAt = publishedAt;
    this._expiresAt = expiresAt;
    this._syncError = null;
    this.touch();
    return Ok(undefined);
  }

  expire(): Result<void> {
    if (!canTransition(this._status, 'expired')) {
      return Err(new InvalidStateError(`Cannot expire from status ${this._status}`));
    }
    this._status = 'expired';
    this.touch();
    return Ok(undefined);
  }

  returnToDraftAfterDelist(): Result<void> {
    if (this._status !== 'live' || !this._marketplaceListingId) {
      return Err(new InvalidStateError('Only a live remote listing can return to draft after delist'));
    }
    this._status = 'draft';
    this._marketplaceListingId = null;
    this._externalUrl = null;
    this._remoteStatus = null;
    this._publishedAt = null;
    this._expiresAt = null;
    this._syncError = null;
    this.touch();
    return Ok(undefined);
  }

  markError(message: string): Result<void> {
    if (!canTransition(this._status, 'error')) {
      return Err(new InvalidStateError(`Cannot mark error from status ${this._status}`));
    }
    this._status = 'error';
    this._syncError = message;
    this.touch();
    return Ok(undefined);
  }

  recordSyncStats(
    stats: { views?: number | null; watchers?: number | null; messages?: number | null; remoteStatus?: string | null },
    at: Date = new Date()
  ): void {
    if (stats.views !== undefined && stats.views !== null) this._views = stats.views;
    if (stats.watchers !== undefined && stats.watchers !== null) this._watchers = stats.watchers;
    if (stats.messages !== undefined && stats.messages !== null) this._messages = stats.messages;
    if (stats.remoteStatus !== undefined) this._remoteStatus = stats.remoteStatus;
    this._lastSyncAt = at;
    this.touch();
  }

  recordMessagesUnavailable(at: Date = new Date()): void {
    this._messages = null;
    this._lastSyncAt = at;
    this.touch();
  }

  recordExternalUrl(url: string | null): void {
    this._externalUrl = url;
    this.touch();
  }

  recordMarketplaceCategory(category: MarketplaceCategoryMetadata | null): void {
    this._marketplaceCategory = category ? { ...category, path: [...category.path] } : null;
    this.touch();
  }

  recordSyncStatusNote(message: string | null): void {
    this._syncError = message;
    this.touch();
  }

  recordImportedStatus(
    status: ListingStatus,
    product: Product | null,
    at: Date = new Date()
  ): Result<void> {
    if (status === 'live' && product && !product.canPublish()) {
      return Err(new InvalidStateError('Cannot mark listing live for a sold product'));
    }
    this._status = status;
    this._publishedAt = status === 'live' ? (this._publishedAt ?? at) : this._publishedAt;
    this.touch();
    return Ok(undefined);
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
