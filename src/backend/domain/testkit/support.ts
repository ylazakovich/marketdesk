// Shared test support: Result unwrapping and in-memory mock repositories /
// AI provider for pure (no DB, no network) domain tests.

import { Result } from '../shared/Result';
import { Money } from '../valueObjects/Money';
import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type { Marketplace } from '../entities/Marketplace';
import type { HermesEvent } from '../entities/HermesEvent';
import type { Workspace } from '../entities/Workspace';
import type { HermesEventStatus, MarketplaceKey } from '../../../shared/types';
import type { IProductRepository } from '../repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../repositories/interfaces/IMarketplaceRepository';
import type { IEventRepository } from '../repositories/interfaces/IEventRepository';
import type { IEventPublisher, DomainEvent } from '../ports/IEventPublisher';
import type {
  IAIProvider,
  PriceSuggestion,
  ListingAnalysis,
} from '../ports/IAIProvider';

export function unwrap<T>(r: Result<T>): T {
  if (r.isErr()) {
    throw r.error;
  }
  return r.value;
}

export function money(amount: number, currency = 'PLN'): Money {
  return unwrap(Money.of(amount, currency));
}

export class InMemoryProductRepository implements IProductRepository {
  readonly items = new Map<string, Product>();
  readonly saved: Product[] = [];

  async findById(id: string): Promise<Product | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Product | null> {
    const product = this.items.get(id);
    return product && product.workspaceId === workspaceId ? product : null;
  }
  async findByIdForWorkspaceForUpdate(id: string, workspaceId: string): Promise<Product | null> {
    return this.findByIdForWorkspace(id, workspaceId);
  }
  async findByWorkspace(workspaceId: string): Promise<Product[]> {
    return [...this.items.values()].filter((p) => p.workspaceId === workspaceId);
  }
  async findBySku(workspaceId: string, sku: string): Promise<Product | null> {
    return (
      [...this.items.values()].find(
        (p) => p.workspaceId === workspaceId && p.sku === sku,
      ) ?? null
    );
  }
  async save(product: Product): Promise<void> {
    this.items.set(product.id, product);
    this.saved.push(product);
  }
  async saveAll(products: Product[]): Promise<void> {
    for (const p of products) await this.save(p);
  }
  async delete(id: string, workspaceId: string): Promise<void> {
    const product = this.items.get(id);
    if (product && product.workspaceId === workspaceId) this.items.delete(id);
  }
}

export class InMemoryListingRepository implements IListingRepository {
  readonly items = new Map<string, Listing>();
  // Optional map of listingId -> workspaceId so tenant-scoped reads can be
  // exercised without a product/workspace join in pure tests.
  readonly listingWorkspaces = new Map<string, string>();

  async findById(id: string): Promise<Listing | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Listing | null> {
    const listing = this.items.get(id);
    if (!listing) return null;
    const owner = this.listingWorkspaces.get(id);
    // If no explicit owner is registered, treat the listing as visible (pure
    // domain tests seed listings without a workspace join).
    return owner === undefined || owner === workspaceId ? listing : null;
  }
  async findByProduct(productId: string): Promise<Listing[]> {
    return [...this.items.values()].filter((l) => l.productId === productId);
  }
  async findByMarketplace(marketplaceId: string): Promise<Listing[]> {
    return [...this.items.values()].filter((l) => l.marketplaceId === marketplaceId);
  }
  async findByWorkspace(): Promise<Listing[]> {
    return [...this.items.values()];
  }
  async findExpiring(before: Date): Promise<Listing[]> {
    return [...this.items.values()].filter(
      (l) => l.isLive() && l.expiresAt !== null && l.expiresAt.getTime() < before.getTime(),
    );
  }
  async save(listing: Listing): Promise<void> {
    this.items.set(listing.id, listing);
  }
  async saveAll(listings: Listing[]): Promise<void> {
    for (const l of listings) await this.save(l);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryMarketplaceRepository implements IMarketplaceRepository {
  readonly items = new Map<string, Marketplace>();

  async findById(id: string): Promise<Marketplace | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Marketplace | null> {
    const marketplace = this.items.get(id);
    return marketplace && marketplace.workspaceId === workspaceId ? marketplace : null;
  }
  async findByWorkspace(workspaceId: string): Promise<Marketplace[]> {
    return [...this.items.values()].filter((m) => m.workspaceId === workspaceId);
  }
  async findConnected(workspaceId: string): Promise<Marketplace[]> {
    return [...this.items.values()].filter(
      (m) => m.workspaceId === workspaceId && m.isConnected(),
    );
  }
  async findByKey(workspaceId: string, key: MarketplaceKey): Promise<Marketplace | null> {
    return (
      [...this.items.values()].find(
        (m) => m.workspaceId === workspaceId && m.key === key,
      ) ?? null
    );
  }
  async save(marketplace: Marketplace): Promise<void> {
    this.items.set(marketplace.id, marketplace);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryEventRepository implements IEventRepository {
  readonly items = new Map<string, HermesEvent>();
  readonly savedBatches: HermesEvent[][] = [];
  readonly recommendationKeys = new Set<string>();

  async findById(id: string): Promise<HermesEvent | null> {
    return this.items.get(id) ?? null;
  }
  async findByIdForWorkspace(id: string, workspaceId: string): Promise<HermesEvent | null> {
    const event = this.items.get(id);
    return event && event.workspaceId === workspaceId ? event : null;
  }
  async findByWorkspace(workspaceId: string): Promise<HermesEvent[]> {
    return [...this.items.values()].filter((e) => e.workspaceId === workspaceId);
  }
  async findByStatus(
    workspaceId: string,
    status: HermesEventStatus,
  ): Promise<HermesEvent[]> {
    return [...this.items.values()].filter(
      (e) => e.workspaceId === workspaceId && e.status === status,
    );
  }
  async findPendingReview(workspaceId: string): Promise<HermesEvent[]> {
    return this.findByStatus(workspaceId, 'pending_review');
  }
  async save(event: HermesEvent): Promise<void> {
    this.items.set(event.id, event);
  }
  async saveRecommendationIfAbsent(event: HermesEvent, idempotencyKey: string): Promise<boolean> {
    const key = `${event.workspaceId}:${idempotencyKey}`;
    if (this.recommendationKeys.has(key)) return false;
    this.recommendationKeys.add(key);
    this.items.set(event.id, event);
    return true;
  }
  async saveAll(events: HermesEvent[]): Promise<void> {
    this.savedBatches.push(events);
    for (const e of events) await this.save(e);
  }
  async deleteOlderThan(): Promise<void> {
    // no-op for tests
  }
}

export class RecordingEventPublisher implements IEventPublisher {
  readonly published: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
  }
}

export class StubAIProvider implements IAIProvider {
  constructor(
    private readonly price: PriceSuggestion = {
      suggestedPrice: 0,
      reasoning: 'stub',
      confidence: 'low',
    },
    private readonly title = '',
    private readonly analysis: ListingAnalysis = { score: 100, suggestions: [] },
  ) {}

  async suggestPrice(): Promise<PriceSuggestion> {
    return this.price;
  }
  async generateTitle(): Promise<string> {
    return this.title;
  }
  async analyzeListing(): Promise<ListingAnalysis> {
    return this.analysis;
  }
}

let counter = 0;
export function sequentialIdFactory(prefix = 'evt'): () => string {
  return () => `${prefix}-${++counter}`;
}

// Silence unused-import complaints for Workspace type re-export convenience.
export type { Workspace };
