// Presenters map rich domain entities to plain, serializable response shapes that
// controllers (Group 5) return directly. Output shapes reuse the shared transport
// types (dates as ISO strings, Money as major-unit numbers) so backend and frontend
// agree. Entities never leak past the application boundary.

import type {
  Product as ProductView,
  Listing as ListingView,
  HermesEvent as HermesEventView,
  Marketplace as MarketplaceView,
} from '../../../shared/types';
import type { Product } from '../../domain/entities/Product';
import type { Listing } from '../../domain/entities/Listing';
import type { HermesEvent } from '../../domain/entities/HermesEvent';
import type { Marketplace } from '../../domain/entities/Marketplace';

function iso(date: Date | null | undefined): string | undefined {
  return date ? date.toISOString() : undefined;
}

function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (!/(^|\.)olx\.pl$/i.test(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function presentProduct(product: Product): ProductView {
  return {
    id: product.id,
    workspaceId: product.workspaceId,
    sku: product.sku,
    name: product.name,
    description: product.description,
    costPrice: product.costPrice.amount,
    sellingPrice: product.sellingPrice.amount,
    condition: product.condition,
    category: product.category,
    status: product.status,
    tags: [...product.tags],
    images: [...product.images],
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function presentListing(listing: Listing): ListingView {
  return {
    id: listing.id,
    productId: listing.productId,
    marketplaceId: listing.marketplaceId,
    marketplaceListingId: listing.marketplaceListingId ?? undefined,
    externalUrl: listing.isLive() ? safeExternalUrl(listing.externalUrl) : undefined,
    price: listing.price.amount,
    status: listing.status,
    views: listing.views,
    watchers: listing.watchers,
    messages: listing.messages,
    metricsAvailability: {
      views: listing.views !== null,
      watchers: listing.watchers !== null,
      messages: listing.messages !== null,
    },
    publishedAt: iso(listing.publishedAt),
    expiresAt: iso(listing.expiresAt),
    syncError: listing.syncError ?? undefined,
    lastSyncAt: iso(listing.lastSyncAt),
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

export function presentHermesEvent(event: HermesEvent): HermesEventView {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    productId: event.productId ?? undefined,
    type: event.type,
    severity: event.severity,
    status: event.status,
    title: event.title,
    detail: event.detail ?? undefined,
    proposedChange: event.proposedChange,
    autonomyDecision: event.autonomyDecision ?? undefined,
    createdAt: event.createdAt.toISOString(),
    resolvedAt: iso(event.resolvedAt),
  };
}

export function presentMarketplace(marketplace: Marketplace): MarketplaceView {
  return {
    id: marketplace.id,
    workspaceId: marketplace.workspaceId,
    key: marketplace.key,
    name: marketplace.name,
    connected: marketplace.isConnected(),
    syncMode: marketplace.syncMode,
    lastSyncAt: iso(marketplace.lastSyncAt),
    errorCount: marketplace.errorCount,
    capacity: marketplace.capacity,
    createdAt: marketplace.createdAt.toISOString(),
  };
}

export type { ProductView, ListingView, HermesEventView, MarketplaceView };
