import { HermesDecisionEngine } from '../services/HermesDecisionEngine';
import { Product } from '../entities/Product';
import { Listing } from '../entities/Listing';
import { Workspace } from '../entities/Workspace';
import { HermesEvent } from '../entities/HermesEvent';
import type { HermesGuardrails } from '../../../shared/types';
import {
  unwrap,
  money,
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  StubAIProvider,
  sequentialIdFactory,
} from '../testkit/support';

function makeEngine(overrides?: {
  productRepo?: InMemoryProductRepository;
  listingRepo?: InMemoryListingRepository;
  eventRepo?: InMemoryEventRepository;
  publisher?: RecordingEventPublisher;
  ai?: StubAIProvider;
}) {
  const productRepo = overrides?.productRepo ?? new InMemoryProductRepository();
  const listingRepo = overrides?.listingRepo ?? new InMemoryListingRepository();
  const eventRepo = overrides?.eventRepo ?? new InMemoryEventRepository();
  const publisher = overrides?.publisher ?? new RecordingEventPublisher();
  const ai = overrides?.ai ?? new StubAIProvider();
  const engine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    publisher,
    ai,
    sequentialIdFactory(),
  );
  return { engine, productRepo, listingRepo, eventRepo, publisher, ai };
}

describe('HermesDecisionEngine.determineAutonomy', () => {
  const { engine } = makeEngine();

  describe('suggest_only', () => {
    it('sends everything to pending_review', () => {
      expect(engine.determineAutonomy('suggest_only', 'create_listing', 'info')).toBe(
        'pending_review',
      );
      expect(
        engine.determineAutonomy('suggest_only', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });

  describe('full_auto', () => {
    it('auto-applies normal suggestions', () => {
      expect(engine.determineAutonomy('full_auto', 'suggested_better_title', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('full_auto', 'suggested_lower_price', 'warning')).toBe(
        'auto_apply',
      );
    });

    it('still routes critical competitor price detections to review', () => {
      expect(
        engine.determineAutonomy('full_auto', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });

  describe('balanced', () => {
    it('auto-applies safe types only', () => {
      expect(engine.determineAutonomy('balanced', 'create_listing', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('balanced', 'update_description', 'info')).toBe(
        'auto_apply',
      );
      expect(engine.determineAutonomy('balanced', 'relist', 'info')).toBe('auto_apply');
    });

    it('routes non-safe types to review', () => {
      expect(engine.determineAutonomy('balanced', 'suggested_lower_price', 'warning')).toBe(
        'pending_review',
      );
      expect(
        engine.determineAutonomy('balanced', 'competitor_price_detected', 'critical'),
      ).toBe('pending_review');
    });
  });
});

describe('HermesDecisionEngine.run', () => {
  function seedProduct(productRepo: InMemoryProductRepository, images: string[]): Product {
    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(80),
        condition: 'new',
        category: 'electronics',
        images,
      }),
    );
    productRepo.items.set(product.id, product);
    return product;
  }

  it('auto-applies a safe info suggestion under full_auto and persists events', async () => {
    const { engine, productRepo, eventRepo, publisher } = makeEngine();
    seedProduct(productRepo, []); // 0 images -> suggested_more_photos (info, null change)

    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'full_auto' }),
    );

    const events = await engine.run(workspace);

    const photoEvent = events.find((e) => e.type === 'suggested_more_photos');
    expect(photoEvent).toBeDefined();
    expect(photoEvent!.autonomyDecision).toBe('auto_apply');
    expect(photoEvent!.status).toBe('applied');
    expect(eventRepo.savedBatches.length).toBeGreaterThanOrEqual(3);
    expect(publisher.published.some((e) => e.type === 'hermes.run_completed')).toBe(true);
  });

  it('keeps suggestions pending under suggest_only', async () => {
    const { engine, productRepo } = makeEngine();
    seedProduct(productRepo, []);

    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'suggest_only' }),
    );

    const events = await engine.run(workspace);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.autonomyDecision).toBe('pending_review');
      expect(event.status).toBe('pending_review');
    }
  });

  it('routes unsupported automatic relists to review before execution', async () => {
    const { engine, productRepo, listingRepo } = makeEngine();
    seedProduct(productRepo, ['a.jpg', 'b.jpg', 'c.jpg']);
    const listing = unwrap(
      Listing.create({
        id: 'l-expired',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(80),
        status: 'expired',
      }),
    );
    listingRepo.items.set(listing.id, listing);
    const workspace = unwrap(
      Workspace.create({ id: 'w1', name: 'WS', autonomyLevel: 'full_auto' }),
    );

    const events = await engine.run(workspace);
    const relist = events.find((event) => event.proposedChange?.kind === 'relist');
    expect(relist).toBeDefined();
    expect(relist?.status).toBe('pending_review');
    expect(relist?.autonomyDecision).toBe('pending_review');
  });
});

describe('HermesDecisionEngine guardrails (C1 / AMENDMENT FIX #5)', () => {
  const OPEN: HermesGuardrails = {
    maxAutoPriceChangePct: 50,
    minMarginFloor: 0,
    autoCreateListings: true,
    autoAdjustPricing: true,
    autoRelist: true,
    smartTitleAndSEO: true,
  };

  function makeWorkspace(guardrails: HermesGuardrails, level = 'full_auto' as const) {
    return unwrap(
      Workspace.create({
        id: 'w1',
        name: 'WS',
        autonomyLevel: level,
        guardrails,
      }),
    );
  }

  // Seeds a product (name matches the stub title so no title event fires) plus a
  // live listing, and an AI stub that suggests a modest 10% price drop with high
  // confidence — an actionable, <20% change that requiresHumanReview() ignores,
  // so the guardrail is the only thing that can force review.
  function seedPricingScenario() {
    const productRepo = new InMemoryProductRepository();
    const listingRepo = new InMemoryListingRepository();
    const eventRepo = new InMemoryEventRepository();
    const publisher = new RecordingEventPublisher();
    const ai = new StubAIProvider(
      { suggestedPrice: 90, reasoning: 'test', confidence: 'high' },
      'Widget', // equals product name -> no suggested_better_title event
    );
    const engine = new HermesDecisionEngine(
      productRepo,
      listingRepo,
      eventRepo,
      publisher,
      ai,
      sequentialIdFactory('g'),
    );

    const product = unwrap(
      Product.create({
        id: 'p1',
        workspaceId: 'w1',
        sku: 'SKU-1',
        name: 'Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'new',
        category: 'electronics',
        images: ['a.jpg', 'b.jpg', 'c.jpg'], // >=3 -> no more-photos event
      }),
    );
    productRepo.items.set(product.id, product);

    const listing = unwrap(
      Listing.create({
        id: 'l1',
        productId: 'p1',
        marketplaceId: 'm1',
        price: money(100),
        status: 'live',
      }),
    );
    listingRepo.items.set(listing.id, listing);

    return { engine, product, productRepo, eventRepo };
  }

  function priceEvent(events: Awaited<ReturnType<HermesDecisionEngine['run']>>) {
    return events.find((e) => e.type === 'suggested_lower_price');
  }

  it('auto-applies a within-guardrail price change under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    const events = await engine.run(makeWorkspace(OPEN));
    const evt = priceEvent(events);
    expect(evt).toBeDefined();
    expect(evt!.autonomyDecision).toBe('auto_apply');
    expect(evt!.status).toBe('applied');
    expect(product.sellingPrice.amount).toBe(90);
  });

  it('persists failed when automatic application throws', async () => {
    const { engine, productRepo, eventRepo } = seedPricingScenario();
    jest.spyOn(productRepo, 'save').mockRejectedValueOnce(new Error('database unavailable'));

    const events = await engine.run(makeWorkspace(OPEN));
    expect(priceEvent(events)?.status).toBe('failed');
    expect(eventRepo.savedBatches.length).toBeGreaterThanOrEqual(3);
  });

  it('forces review when autoAdjustPricing is disabled, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    const events = await engine.run(makeWorkspace({ ...OPEN, autoAdjustPricing: false }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(evt!.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100); // unchanged — not applied
  });

  it('forces review when the change exceeds maxAutoPriceChangePct, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    // 10% drop exceeds a 5% cap.
    const events = await engine.run(makeWorkspace({ ...OPEN, maxAutoPriceChangePct: 5 }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(evt!.status).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('forces review when the new margin is below minMarginFloor, even under full_auto', async () => {
    const { engine, product } = seedPricingScenario();
    // to=90, cost=50 -> margin = (90-50)/90 ≈ 44%; floor of 60% is breached.
    const events = await engine.run(makeWorkspace({ ...OPEN, minMarginFloor: 60 }));
    const evt = priceEvent(events);
    expect(evt!.autonomyDecision).toBe('pending_review');
    expect(product.sellingPrice.amount).toBe(100);
  });

  it('passesGuardrails honours per-action master switches', () => {
    const { engine, product } = seedPricingScenario();
    const ws = makeWorkspace({ ...OPEN, smartTitleAndSEO: false });
    const titleEvent = unwrap(
      HermesEvent.create({
        id: 't1',
        workspaceId: 'w1',
        productId: 'p1',
        type: 'suggested_better_title',
        severity: 'info',
        title: 'better title',
        proposedChange: { kind: 'title', field: 'title', from: 'Widget', to: 'Widget Pro' },
      }),
    );
    expect(engine.passesGuardrails(product, titleEvent, ws)).toBe(false);
  });
});
