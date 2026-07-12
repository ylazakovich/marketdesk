import { ClaudeAI, AITextCompletionClient, AICompletionRequest } from '../ClaudeAI';
import { Product } from '../../../domain/entities/Product';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Money } from '../../../domain/valueObjects/Money';
import type { PriceSuggestionContext } from '../../../domain/ports/IAIProvider';

function money(amount: number): Money {
  const r = Money.of(amount, 'PLN');
  if (r.isErr()) throw r.error;
  return r.value;
}

function buildProduct(): Product {
  const r = Product.create({
    id: 'p1',
    workspaceId: 'w1',
    sku: 'SKU-1',
    name: 'Retro Sneakers',
    description: 'Classic retro sneakers, lightly worn, great condition overall.',
    costPrice: money(80),
    sellingPrice: money(120),
    condition: 'good',
    category: 'clothing',
    images: ['https://img/a.jpg'],
    tags: ['retro', 'sneakers'],
  });
  if (r.isErr()) throw r.error;
  return r.value;
}

function buildListing(): Listing {
  const r = Listing.create({
    id: 'l1',
    productId: 'p1',
    marketplaceId: 'm1',
    price: money(120),
  });
  if (r.isErr()) throw r.error;
  return r.value;
}

function buildMarketplace(): Marketplace {
  const r = Marketplace.create({ id: 'm1', workspaceId: 'w1', key: 'olx', name: 'OLX' });
  if (r.isErr()) throw r.error;
  return r.value;
}

function fakeClient(reply: string | ((req: AICompletionRequest) => string)): {
  client: AITextCompletionClient;
  calls: AICompletionRequest[];
} {
  const calls: AICompletionRequest[] = [];
  const client: AITextCompletionClient = {
    complete: async (req) => {
      calls.push(req);
      return typeof reply === 'function' ? reply(req) : reply;
    },
  };
  return { client, calls };
}

describe('ClaudeAI (IAIProvider)', () => {
  it('suggestPrice returns the typed PriceSuggestion shape and passes a JSON schema', async () => {
    const { client, calls } = fakeClient(
      JSON.stringify({
        suggestedPrice: 99.5,
        reasoning: 'High views but low conversion — a small drop should convert.',
        confidence: 'high',
      }),
    );
    const ai = new ClaudeAI(client);
    const context: PriceSuggestionContext = {
      listing: buildListing(),
      recentViews: 300,
      conversionRate: 0.01,
      competitorPrice: 95,
    };

    const result = await ai.suggestPrice(context);

    expect(result.suggestedPrice).toBe(99.5);
    expect(result.confidence).toBe('high');
    expect(result.reasoning).toContain('convert');
    expect(calls[0].jsonSchema).toBeDefined();
  });

  it('suggestPrice falls back to current price / low confidence on unparseable output', async () => {
    const { client } = fakeClient('not json at all');
    const ai = new ClaudeAI(client);
    const result = await ai.suggestPrice({
      listing: buildListing(),
      recentViews: 10,
      conversionRate: 0.2,
    });
    expect(result.suggestedPrice).toBe(120); // current listing price
    expect(result.confidence).toBe('low');
  });

  it('suggestPrice tolerates JSON wrapped in a fenced code block', async () => {
    const { client } = fakeClient(
      '```json\n{"suggestedPrice": 110, "reasoning": "ok", "confidence": "medium"}\n```',
    );
    const ai = new ClaudeAI(client);
    const result = await ai.suggestPrice({
      listing: buildListing(),
      recentViews: 5,
      conversionRate: 0.05,
    });
    expect(result.suggestedPrice).toBe(110);
    expect(result.confidence).toBe('medium');
  });

  it('generateTitle returns a cleaned single-line title and includes marketplace context', async () => {
    const { client, calls } = fakeClient('  "Retro Sneakers — Classic Lightly Worn"  ');
    const ai = new ClaudeAI(client);

    const title = await ai.generateTitle(buildProduct(), buildMarketplace());

    expect(title).toBe('Retro Sneakers — Classic Lightly Worn');
    expect(calls[0].prompt).toContain('OLX');
  });

  it('generateTitle falls back to the product name on empty model output', async () => {
    const { client } = fakeClient('   ');
    const ai = new ClaudeAI(client);
    const title = await ai.generateTitle(buildProduct(), null);
    expect(title).toBe('Retro Sneakers');
  });

  it('analyzeListing clamps the score and returns string suggestions', async () => {
    const { client } = fakeClient(
      JSON.stringify({ score: 250, suggestions: ['Add more photos', 42, 'Improve title'] }),
    );
    const ai = new ClaudeAI(client);

    const analysis = await ai.analyzeListing(buildProduct());

    expect(analysis.score).toBe(100); // clamped from 250
    expect(analysis.suggestions).toEqual(['Add more photos', 'Improve title']);
  });
});
