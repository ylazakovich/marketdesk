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

function setup() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const eventRepo = new InMemoryEventRepository();
  const publisher = new RecordingEventPublisher();
  const workspaceRepo = new InMemoryWorkspaceRepository();

  const workspace = unwrap(
    Workspace.create({ id: 'ws-1', name: 'Test', autonomyLevel: 'suggest_only' }),
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
    }),
  );
  productRepo.items.set(product.id, product);

  const engine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    publisher,
    new StubAIProvider(),
    sequentialIdFactory('evt'),
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
    idFactory('rec'),
  );
  const dismiss = new DismissHermesEventUseCase(
    eventRepo,
    new InMemoryActivityLogRepository(),
    publisher,
    idFactory('rec2'),
  );
  const service = new HermesApplicationService(eventRepo, runHermes, approve, dismiss);

  return { runHermes, service, eventRepo, publisher, workspaceRepo };
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

  it('exposes generated events as presented views via the application service', async () => {
    const { service } = setup();

    const result = await service.runHermes({ workspaceId: 'ws-1' });

    expect(result.isOk()).toBe(true);
    const views = unwrap(result);
    expect(views[0]).toHaveProperty('createdAt');
    expect(typeof views[0].createdAt).toBe('string');
  });
});
