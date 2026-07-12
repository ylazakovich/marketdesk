// Claude-backed implementation of the domain IAIProvider port
// (ARCHITECTURE_AMENDMENTS FIX #1: IAIProvider is a domain PORT; this Claude
// implementation is infrastructure). No model ID or API key is hardcoded — both
// are read from config/env with sensible, overridable defaults. The actual LLM
// call goes through a thin injectable completion client so the provider is fully
// unit-testable without any network access.

import type {
  IAIProvider,
  PriceSuggestionContext,
  PriceSuggestion,
  ListingAnalysis,
} from '../../domain/ports/IAIProvider';
import type { Product } from '../../domain/entities/Product';
import type { Marketplace } from '../../domain/entities/Marketplace';

// A currently-valid Anthropic model id (verified against the current Anthropic
// model list). Overridable via CLAUDE_MODEL — never hardcoded deep in the
// domain, never invented. (C4)
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';

export interface ClaudeAIConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

// Read config from the environment. Falls back to the standard ANTHROPIC_API_KEY
// if CLAUDE_API_KEY is not set. No secret is ever embedded in source.
export function loadClaudeConfig(): ClaudeAIConfig {
  return {
    apiKey: process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL,
    maxTokens: Number.parseInt(process.env.CLAUDE_MAX_TOKENS ?? '2048', 10),
  };
}

// Thin completion boundary. The concrete Anthropic-SDK implementation lives in
// AnthropicCompletionClient; tests inject a fake.
export interface AICompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  // When provided, the model is constrained to emit JSON matching this schema.
  jsonSchema?: Record<string, unknown>;
}

export interface AITextCompletionClient {
  complete(request: AICompletionRequest): Promise<string>;
}

export class ClaudeAI implements IAIProvider {
  private readonly client: AITextCompletionClient;
  private readonly maxTokens: number;

  constructor(client: AITextCompletionClient, config?: Pick<ClaudeAIConfig, 'maxTokens'>) {
    this.client = client;
    this.maxTokens = config?.maxTokens ?? loadClaudeConfig().maxTokens;
  }

  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    const { listing, recentViews, conversionRate, competitorPrice } = context;
    const currentPrice = listing.price.amount;
    const currency = listing.price.currency;

    const prompt = [
      'You are a pricing strategist for an online marketplace listing.',
      `Current price: ${currentPrice} ${currency}.`,
      `Recent views: ${recentViews}. Conversion rate: ${(conversionRate * 100).toFixed(2)}%.`,
      competitorPrice !== undefined
        ? `Observed competitor price: ${competitorPrice} ${currency}.`
        : 'No competitor price observed.',
      'Suggest an optimal price and briefly justify it. Respond as JSON with keys',
      '"suggestedPrice" (number, same currency), "reasoning" (string),',
      '"confidence" (one of "high", "medium", "low").',
    ].join('\n');

    const raw = await this.client.complete({
      system: 'You output concise, data-driven pricing recommendations as strict JSON.',
      prompt,
      maxTokens: this.maxTokens,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          suggestedPrice: { type: 'number' },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['suggestedPrice', 'reasoning', 'confidence'],
      },
    });

    const parsed = this.parseJson(raw);
    const suggestedPrice = this.asFiniteNumber(parsed?.suggestedPrice, currentPrice);
    const confidence = this.asConfidence(parsed?.confidence);
    const reasoning =
      typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'No reasoning provided by the model.';

    return { suggestedPrice, reasoning, confidence };
  }

  async generateTitle(product: Product, marketplace: Marketplace | null): Promise<string> {
    const prompt = [
      'Write a single SEO-optimized marketplace listing title.',
      `Product: ${product.name}.`,
      `Category: ${product.category}. Condition: ${product.condition}.`,
      marketplace ? `Target marketplace: ${marketplace.name}.` : '',
      'Return only the title text, no quotes, no preamble, max 80 characters.',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await this.client.complete({
      system: 'You are an SEO copywriter. Output only the requested title.',
      prompt,
      maxTokens: this.maxTokens,
    });

    return this.cleanTitle(raw) || product.name;
  }

  async analyzeListing(product: Product): Promise<ListingAnalysis> {
    const prompt = [
      'Assess the quality of this product listing and suggest improvements.',
      `Name: ${product.name}.`,
      `Description: ${product.description}.`,
      `Category: ${product.category}. Condition: ${product.condition}.`,
      `Images: ${product.imageCount}. Tags: ${product.tags.join(', ') || 'none'}.`,
      'Respond as JSON with keys "score" (integer 0-100) and',
      '"suggestions" (array of short actionable strings).',
    ].join('\n');

    const raw = await this.client.complete({
      system: 'You output listing-quality assessments as strict JSON.',
      prompt,
      maxTokens: this.maxTokens,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          score: { type: 'integer' },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
        required: ['score', 'suggestions'],
      },
    });

    const parsed = this.parseJson(raw);
    const score = this.clampScore(this.asFiniteNumber(parsed?.score, 0));
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === 'string')
      : [];

    return { score, suggestions };
  }

  // --- helpers ---

  private parseJson(raw: string): Record<string, unknown> | null {
    const text = raw.trim();
    // Tolerate fenced code blocks the model may wrap JSON in.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : text;
    try {
      const value = JSON.parse(candidate);
      return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private asFiniteNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  }

  private asConfidence(value: unknown): PriceSuggestion['confidence'] {
    return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
  }

  private clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private cleanTitle(raw: string): string {
    return raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim();
  }
}
