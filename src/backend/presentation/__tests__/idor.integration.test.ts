// S2 IDOR regression tests. Wires the REAL application services / use cases over
// in-memory repositories with TWO workspaces (A and B), then drives cross-tenant
// requests: a user authenticated for workspace A must get 404 when fetching or
// mutating a workspace B resource (product, listing, marketplace, hermes event),
// and workspace read/update must operate on the caller's own workspace regardless
// of the :id path param.

import request from 'supertest';
import bcrypt from 'bcryptjs';

import { buildApp, type AppDeps } from '../http/app';
import { signToken } from '../http/middleware/AuthMiddleware';
import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../http/ports/IAuthUserStore';

import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  StubAIProvider,
  unwrap,
  money,
} from '../../domain/testkit/support';
import {
  InMemoryWorkspaceRepository,
  InMemoryActivityLogRepository,
  RecordingPriceHistoryRecorder,
  RecordingJobQueue,
  idFactory,
} from '../../application/testkit/support';

import { Workspace } from '../../domain/entities/Workspace';
import { Marketplace } from '../../domain/entities/Marketplace';
import { Listing } from '../../domain/entities/Listing';
import { Product } from '../../domain/entities/Product';
import { HermesEvent } from '../../domain/entities/HermesEvent';

import { ProductService } from '../../domain/services/ProductService';
import { HermesDecisionEngine } from '../../domain/services/HermesDecisionEngine';

import { CreateProductUseCase } from '../../application/usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../../application/usecases/UpdateProductUseCase';
import { PublishListingUseCase } from '../../application/usecases/PublishListingUseCase';
import { SyncMarketplaceUseCase } from '../../application/usecases/SyncMarketplaceUseCase';
import { RunHermesUseCase } from '../../application/usecases/RunHermesUseCase';
import { ApproveHermesEventUseCase } from '../../application/usecases/ApproveHermesEventUseCase';
import { DismissHermesEventUseCase } from '../../application/usecases/DismissHermesEventUseCase';
import { ProductApplicationService } from '../../application/services/ProductApplicationService';
import { ListingApplicationService } from '../../application/services/ListingApplicationService';
import { HermesApplicationService } from '../../application/services/HermesApplicationService';
import { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';

const WS_A = 'ws-a';
const WS_B = 'ws-b';

class InMemoryAuthStore implements IAuthUserStore {
  readonly users: AuthUserRecord[] = [];
  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.users.find((u) => u.email === email) ?? null;
  }
  async findById(id: string): Promise<AuthUserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async create(input: CreateAuthUserInput): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      id: `u-${this.users.length + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      workspaceId: input.workspaceId,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }
}

interface Ctx {
  app: ReturnType<typeof buildApp>;
  productBId: string;
  listingBId: string;
  marketplaceBId: string;
  eventBId: string;
  workspaceRepo: InMemoryWorkspaceRepository;
}

async function build(): Promise<Ctx> {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const eventRepo = new InMemoryEventRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const activityLog = new InMemoryActivityLogRepository();
  const priceHistory = new RecordingPriceHistoryRecorder();
  const events = new RecordingEventPublisher();
  const aiProvider = new StubAIProvider();
  const idGenerator = idFactory('id');
  const authStore = new InMemoryAuthStore();

  for (const id of [WS_A, WS_B]) {
    workspaceRepo.items.set(
      id,
      unwrap(Workspace.create({ id, name: `Workspace ${id}`, currency: 'PLN' })),
    );
  }

  authStore.users.push({
    id: 'u-a',
    email: 'a@example.com',
    passwordHash: await bcrypt.hash('secret123', 4),
    workspaceId: WS_A,
    createdAt: new Date(),
  });

  // Seed workspace B resources.
  const productB = unwrap(
    Product.create({
      id: 'prod-b',
      workspaceId: WS_B,
      sku: 'B-1',
      name: 'B Widget',
      description: 'A widget owned exclusively by workspace B for IDOR testing.',
      costPrice: money(10),
      sellingPrice: money(20),
      condition: 'good',
      category: 'misc',
    }),
  );
  productRepo.items.set(productB.id, productB);

  const marketplaceB = unwrap(
    Marketplace.create({
      id: 'mkt-b',
      workspaceId: WS_B,
      key: 'olx',
      name: 'OLX-B',
      connected: true,
    }),
  );
  marketplaceRepo.items.set(marketplaceB.id, marketplaceB);

  const listingB = unwrap(
    Listing.create({
      id: 'lst-b',
      productId: productB.id,
      marketplaceId: marketplaceB.id,
      price: money(20),
      status: 'live',
    }),
  );
  listingRepo.items.set(listingB.id, listingB);
  // Register the tenant owner so findByIdForWorkspace enforces scoping.
  listingRepo.listingWorkspaces.set(listingB.id, WS_B);

  const eventB = unwrap(
    HermesEvent.create({
      id: 'evt-b',
      workspaceId: WS_B,
      productId: productB.id,
      type: 'suggested_lower_price',
      severity: 'warning',
      title: 'Lower B price',
      proposedChange: { kind: 'price', field: 'price', from: 20, to: 18 },
    }),
  );
  eventRepo.items.set(eventB.id, eventB);

  const productDomainService = new ProductService(productRepo, events);
  const hermesEngine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    events,
    aiProvider,
    idGenerator,
  );

  const publishQueue = new RecordingJobQueue();
  const syncQueue = new RecordingJobQueue();

  const createProductUC = new CreateProductUseCase(
    productDomainService,
    workspaceRepo,
    idGenerator,
  );
  const updateProductUC = new UpdateProductUseCase(productRepo, events);
  const publishListingUC = new PublishListingUseCase(
    listingRepo,
    productRepo,
    marketplaceRepo,
    publishQueue,
    activityLog,
    idGenerator,
    undefined,
    {
      authorize: async () => ({ decision: 'allow' }),
    } as any,
  );
  const syncMarketplaceUC = new SyncMarketplaceUseCase(
    marketplaceRepo,
    listingRepo,
    syncQueue,
  );
  const runHermesUC = new RunHermesUseCase(hermesEngine, workspaceRepo);
  const approveEventUC = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    activityLog,
    priceHistory,
    publishQueue,
    events,
    idGenerator,
  );
  const dismissEventUC = new DismissHermesEventUseCase(
    eventRepo,
    activityLog,
    events,
    idGenerator,
  );

  const productService = new ProductApplicationService(
    productRepo,
    createProductUC,
    updateProductUC,
  );
  const listingService = new ListingApplicationService(
    listingRepo,
    publishListingUC,
    syncMarketplaceUC,
  );
  const hermesService = new HermesApplicationService(
    eventRepo,
    runHermesUC,
    approveEventUC,
    dismissEventUC,
  );
  const analyticsService = new AnalyticsApplicationService(productRepo, listingRepo, marketplaceRepo);

  const deps: AppDeps = {
    productService,
    listingService,
    hermesService,
    analyticsService,
    productRepo,
    listingRepo,
    marketplaceRepo,
    workspaceRepo,
    authUserStore: authStore,
    priceHistoryReader: priceHistory as never,
    priceHistoryRecorder: priceHistory,
    idGenerator,
  };

  return {
    app: buildApp(deps, { enableRateLimit: false }),
    productBId: productB.id,
    listingBId: listingB.id,
    marketplaceBId: marketplaceB.id,
    eventBId: eventB.id,
    workspaceRepo,
  };
}

const tokenA = signToken({ userId: 'u-a', workspaceId: WS_A });
const authA = (req: request.Test) => req.set('Authorization', `Bearer ${tokenA}`);

describe('IDOR: workspace A cannot reach workspace B resources (S2)', () => {
  it('GET /products/:idB -> 404', async () => {
    const { app, productBId } = await build();
    const res = await authA(request(app).get(`/api/products/${productBId}`));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /products/:idB -> 404 (no mutation)', async () => {
    const { app, productBId } = await build();
    const res = await authA(request(app).patch(`/api/products/${productBId}`)).send({
      name: 'hijacked',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('DELETE /products/:idB -> 404 (no delete)', async () => {
    const { app, productBId } = await build();
    const res = await authA(request(app).delete(`/api/products/${productBId}`));
    expect(res.status).toBe(404);
    // Still fetchable by nobody cross-tenant, but present for its owner.
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /products/:idB/listings -> 404', async () => {
    const { app, productBId } = await build();
    const res = await authA(request(app).get(`/api/products/${productBId}/listings`));
    expect(res.status).toBe(404);
  });

  it('GET /listings/:idB -> 404', async () => {
    const { app, listingBId } = await build();
    const res = await authA(request(app).get(`/api/listings/${listingBId}`));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('PATCH /listings/:idB (price) -> 404', async () => {
    const { app, listingBId } = await build();
    const res = await authA(request(app).patch(`/api/listings/${listingBId}`)).send({
      price: 1,
    });
    expect(res.status).toBe(404);
  });

  it('POST /listings/:idB/publish -> 404 (no cross-tenant publish)', async () => {
    const { app, listingBId } = await build();
    const res = await authA(
      request(app).post(`/api/listings/${listingBId}/publish`),
    ).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /marketplaces/:idB -> 404', async () => {
    const { app, marketplaceBId } = await build();
    const res = await authA(request(app).get(`/api/marketplaces/${marketplaceBId}`));
    expect(res.status).toBe(404);
  });

  it('POST /hermes/events/:idB/approve -> 404 (event untouched)', async () => {
    const { app, eventBId } = await build();
    const res = await authA(
      request(app).post(`/api/hermes/events/${eventBId}/approve`),
    ).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /hermes/events/:idB -> 404', async () => {
    const { app, eventBId } = await build();
    const res = await authA(request(app).get(`/api/hermes/events/${eventBId}`));
    expect(res.status).toBe(404);
  });

  it('PATCH /workspaces/:idB operates on the caller OWN workspace, not B', async () => {
    const { app, workspaceRepo } = await build();
    const res = await authA(request(app).patch(`/api/workspaces/${WS_B}`)).send({
      name: 'Renamed by A',
    });
    expect(res.status).toBe(200);
    // The caller's own workspace (A) was renamed; B is untouched.
    expect(res.body.data.id).toBe(WS_A);
    expect(res.body.data.name).toBe('Renamed by A');
    const wsB = await workspaceRepo.findById(WS_B);
    expect(wsB!.name).toBe(`Workspace ${WS_B}`);
  });

  it('GET /workspaces/:idB returns the caller OWN workspace (A)', async () => {
    const { app } = await build();
    const res = await authA(request(app).get(`/api/workspaces/${WS_B}`));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(WS_A);
  });
});
