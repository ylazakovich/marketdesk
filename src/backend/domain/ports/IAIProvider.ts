// Domain port for the AI provider (ARCHITECTURE_AMENDMENTS FIX #1).
// The domain depends ONLY on this abstraction — no vendor/model detail leaks in.
// Concrete implementations (e.g. ClaudeAIProvider) live in infrastructure.

import type { Product } from '../entities/Product';
import type { Listing } from '../entities/Listing';
import type { Marketplace } from '../entities/Marketplace';

export interface PriceSuggestionContext {
  listing: Listing;
  recentViews: number;
  conversionRate: number;
  competitorPrice?: number;
}

export interface PriceSuggestion {
  suggestedPrice: number;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ListingAnalysis {
  score: number; // 0-100
  suggestions: string[];
}

export interface IAIProvider {
  // Generate a pricing suggestion for a listing.
  suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion>;

  // Generate an SEO-optimized title for a marketplace (marketplace may be null
  // until per-marketplace titles are implemented).
  generateTitle(product: Product, marketplace: Marketplace | null): Promise<string>;

  // Analyze product listing quality and suggest improvements.
  analyzeListing(product: Product): Promise<ListingAnalysis>;
}
