import { RunHermesUseCase } from '../usecases/RunHermesUseCase';
import { HermesApplicationService } from '../services/HermesApplicationService';
import { ApproveHermesEventUseCase } from '../usecases/ApproveHermesEventUseCase';
import { DismissHermesEventUseCase } from '../usecases/DismissHermesEventUseCase';
import { HermesDecisionEngine } from '../../domain/services/HermesDecisionEngine';
import { Product } from '../../domain/entities/Product';
import { Workspace } from '../../domain/entities/Workspace';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  StubAIProvider,
  sequentialIdFactory,
  unwrap,
  money,
} from '../../domain/testkit/support';
import {
  InMemoryWorkspaceRepository,
  InMemoryActivityLogRepository,
  RecordingPriceHistoryRecorder,
  RecordingJobQueue,
  idFactory,
} from '../testkit/support';
import type { IAIProvider } from '../../domain/ports/IAIProvider';

function setup(aiProvider: IAIProvider = new StubAIProvider()) {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const eventRepo = new InMemoryEventRepository();
  const publisher = new RecordingEventPublisher();
  const workspaceRepo = new InMemoryWorkspaceRepository();

  const workspace = unwrap(
    Workspace.create({ id: 'ws-1', name: 'Test', autonomyLevel: 'suggest_only' })
  );
  workspaceRepo.items.set(workspace.id, workspace);

  // Product with < 3 images -> Hermes suggests "add more photos".
  const product = unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'SKU-1',
      name: 'Lamp',
      description: 'A beautiful vintage brass lamp in excellent condition.',
      costPrice: money(50),
      sellingPrice: money(100),
      condition: 'good',
      category: 'home',
    })
  );
  productRepo.items.set(product.id, product);

  const engine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    publisher,
    aiProvider,
    sequentialIdFactory('evt')
  );

  const runHermes = new RunHermesUseCase(engine, workspaceRepo);
  const approve = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    new InMemoryActivityLogRepository(),
    new RecordingPriceHistoryRecorder(),
    new RecordingJobQueue(),
    publisher,
    idFactory('rec')
  );
  const dismiss = new DismissHermesEventUseCase(
    eventRepo,
    new InMemoryActivityLogRepository(),
    publisher,
    idFactory('rec2')
  );
  const service = new HermesApplicationService(eventRepo, runHermes, approve, dismiss);

  return { runHermes, service, eventRepo, publisher, workspaceRepo, productRepo };
}

describe('RunHermesUseCase', () => {
  it('runs the engine and persists generated events', async () => {
    const { runHermes, eventRepo, publisher } = setup();

    const result = await runHermes.execute({ workspaceId: 'ws-1' });

    expect(result.isOk()).toBe(true);
    const events = unwrap(result);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.status === 'pending_review')).toBe(true);
    expect(eventRepo.items.size).toBe(events.length);
    expect(publisher.published.map((e) => e.type)).toContain('hermes.run_completed');
  });

  it('fails when the workspace is missing', async () => {
    const { runHermes } = setup();
    const result = await runHermes.execute({ workspaceId: 'missing' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('runs listing-seo for exactly one product and keeps it review-only', async () => {
    const { runHermes, eventRepo, productRepo } = setup();
    const product = productRepo.items.get('prod-1');
    expect(product).toBeDefined();
    const saveProduct = jest.spyOn(productRepo, 'save');
    const result = await runHermes.execute({ workspaceId: 'ws-1', productId: 'prod-1' });
    const events = unwrap(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      productId: 'prod-1',
      status: 'pending_review',
      autonomyDecision: 'pending_review',
    });
    expect(events[0].detail).toContain('listing-seo@1.0.0');
    expect(product?.name).toBe('Lamp');
    expect(product?.description).toBe('A beautiful vintage brass lamp in excellent condition.');
    expect(saveProduct).not.toHaveBeenCalled();
    expect(
      unwrap(await runHermes.execute({ workspaceId: 'ws-1', productId: 'prod-1' }))
    ).toHaveLength(0);
    expect(eventRepo.items.size).toBe(1);
    expect([...eventRepo.agentRecommendations.values()]).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: events[0].id,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        outcome: 'suggested',
      }),
      expect.objectContaining({
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: null,
        outcome: 'suppressed',
      }),
    ]);
  });

  it('records structured failed listing-seo provenance without sensitive payloads', async () => {
    const failingProvider = {
      ...new StubAIProvider(),
      analyzeListingSeo: async () => {
        throw new Error('Hermes unavailable');
      },
    } as IAIProvider;
    const { runHermes, eventRepo } = setup(failingProvider);

    const result = await runHermes.execute({ workspaceId: 'ws-1', productId: 'prod-1' });

    expect(result.isErr()).toBe(true);
    expect(eventRepo.items.size).toBe(0);
    expect([...eventRepo.agentRecommendations.values()]).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-1',
        productId: 'prod-1',
        eventId: null,
        agentId: 'listing-seo',
        agentVersion: '1.0.0',
        creativityPreset: 'balanced',
        outcome: 'failed',
      }),
    ]);
  });

  it('records failed provenance when listing-seo input schema validation fails', async () => {
    const { runHermes, eventRepo, productRepo } = setup();
    const invalidTagsProduct = unwrap(
      Product.create({
        id: 'prod-invalid-tags',
        workspaceId: 'ws-1',
        sku: 'SKU-TAGS',
        name: 'Taggy lamp',
        description: 'A product with too many tags for the agent input schema.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'good',
        category: 'home',
        tags: Array.from({ length: 51 }, (_unused, index) => `tag-${index}`),
      })
    );
    productRepo.items.set(invalidTagsProduct.id, invalidTagsProduct);

    const result = await runHermes.execute({
      workspaceId: 'ws-1',
      productId: invalidTagsProduct.id,
    });

    expect(result.isErr()).toBe(true);
    expect(eventRepo.items.size).toBe(0);
    expect([...eventRepo.agentRecommendations.values()]).toEqual([
      expect.objectContaining({
        workspaceId: 'ws-1',
        productId: invalidTagsProduct.id,
        eventId: null,
        outcome: 'failed',
        sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        recommendationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it('accepts a long valid product name at the listing-seo schema boundary', async () => {
    const { runHermes, eventRepo, productRepo } = setup();
    const longNameProduct = unwrap(
      Product.create({
        id: 'prod-long-name',
        workspaceId: 'ws-1',
        sku: 'SKU-LONG',
        name: 'L'.repeat(200),
        description: 'A product with a long but schema-valid title for SEO analysis.',
        costPrice: money(50),
        sellingPrice: money(100),
        condition: 'good',
        category: 'home',
      })
    );
    productRepo.items.set(longNameProduct.id, longNameProduct);

    const result = await runHermes.execute({ workspaceId: 'ws-1', productId: longNameProduct.id });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toHaveLength(1);
    expect([...eventRepo.agentRecommendations.values()][0]).toMatchObject({
      productId: longNameProduct.id,
      outcome: 'suggested',
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('rejects a product outside the authenticated workspace', async () => {
    const { runHermes, productRepo } = setup();
    const foreign = unwrap(
      Product.create({
        id: 'foreign',
        workspaceId: 'ws-2',
        sku: 'FOREIGN',
        name: 'Foreign lamp',
        description: 'A foreign workspace product that must never be analyzed.',
        costPrice: money(10),
        sellingPrice: money(20),
        condition: 'good',
        category: 'home',
      })
    );
    productRepo.items.set(foreign.id, foreign);
    const result = await runHermes.execute({ workspaceId: 'ws-1', productId: foreign.id });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('exposes generated events as presented views via the application service', async () => {
    const { service } = setup();

    const result = await service.runHermes({ workspaceId: 'ws-1' });

    expect(result.isOk()).toBe(true);
    const views = unwrap(result);
    expect(views[0]).toHaveProperty('createdAt');
    expect(typeof views[0].createdAt).toBe('string');
  });
});
