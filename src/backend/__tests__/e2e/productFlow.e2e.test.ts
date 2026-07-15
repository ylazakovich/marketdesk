// End-to-end API flow tests (Group 10). These exercise the REAL application services,
// use cases and domain services wired over in-memory repositories — NO live Postgres
// or Redis. The full request path is driven with supertest against buildApp(deps):
//   login -> me -> create product -> list -> publish listing -> run Hermes ->
//   approve event -> verify applied.
//
// The publish queue is a synchronous fake that invokes the real PublishListingHandler
// (with a fake marketplace adapter + the domain ListingService finalizer), so a
// publish request finalizes the listing in-process and a subsequent read reflects the
// live state — proving the Group 10 handler-finalization fix end-to-end.

import request from 'supertest';
import bcrypt from 'bcryptjs';

import { buildApp, type AppDeps } from '../../presentation/http/app';
import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../../presentation/http/ports/IAuthUserStore';

import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  RecordingEventPublisher,
  StubAIProvider,
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
import { HermesEvent } from '../../domain/entities/HermesEvent';
import { unwrap } from '../../domain/testkit/support';

import { ProductService } from '../../domain/services/ProductService';
import { ListingService } from '../../domain/services/ListingService';
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

import { PublishListingHandler } from '../../infrastructure/jobQueue/JobHandlers/PublishListingHandler';
import type { MarketplaceAdapterResolver } from '../../infrastructure/jobQueue/JobHandlers/SyncMarketplaceHandler';
import type {
  IMarketplaceAdapter,
  PublishResult,
} from '../../domain/services/MarketplaceAdapter';

import type { IJobQueue, PublishListingJob } from '../../application/ports/IJobQueue';

const WORKSPACE_ID = 'ws-1';
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'secret123';

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

// A fake marketplace adapter that "publishes" successfully and returns an external id.
function fakeAdapter(externalId: string): IMarketplaceAdapter {
  const publishResult: PublishResult = {
    externalListingId: externalId,
    publishedAt: new Date('2026-07-12T00:00:00.000Z'),
  };
  return {
    getKey: () => 'olx',
    publish: async () => publishResult,
    updateListing: async () => undefined,
    delist: async () => undefined,
    sync: async () => [],
    fetchListing: async () => null,
  };
}

// A synchronous publish queue: enqueue immediately runs the real PublishListingHandler,
// finalizing the listing via the domain ListingService (Group 10 fix under test).
class SyncPublishQueue implements IJobQueue<PublishListingJob> {
  constructor(private readonly handler: PublishListingHandler) {}
  async enqueue(data: PublishListingJob): Promise<void> {
    await this.handler.handle(data);
  }
}

interface E2EContext {
  app: ReturnType<typeof buildApp>;
  deps: AppDeps;
  listingRepo: InMemoryListingRepository;
  eventRepo: InMemoryEventRepository;
}

async function buildE2E(): Promise<E2EContext> {
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

  // Seed the tenant workspace + a connected marketplace + auth user.
  workspaceRepo.items.set(
    WORKSPACE_ID,
    unwrap(Workspace.create({ id: WORKSPACE_ID, name: 'Demo Workspace', currency: 'PLN' })),
  );
  const marketplace = unwrap(
    Marketplace.create({
      id: 'm-1',
      workspaceId: WORKSPACE_ID,
      key: 'olx',
      name: 'OLX',
      connected: true,
    }),
  );
  marketplaceRepo.items.set(marketplace.id, marketplace);
  authStore.users.push({
    id: 'u-1',
    email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, 4),
    workspaceId: WORKSPACE_ID,
    createdAt: new Date(),
  });

  // Domain services.
  const productDomainService = new ProductService(productRepo, events);
  const listingDomainService = new ListingService(
    listingRepo,
    productRepo,
    marketplaceRepo,
    events,
  );
  const hermesEngine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    events,
    aiProvider,
    idGenerator,
  );

  // Synchronous publish queue backed by the real handler + domain finalizer.
  const adapterResolver: MarketplaceAdapterResolver = {
    create: () => fakeAdapter('olx-external-1'),
  };
  const publishHandler = new PublishListingHandler(
    adapterResolver,
    events,
    listingDomainService,
  );
  const publishQueue = new SyncPublishQueue(publishHandler);
  const syncQueue = new RecordingJobQueue();

  // Use cases.
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

  // Application services.
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
    idGenerator,
  };

  return {
    app: buildApp(deps, { enableRateLimit: false }),
    deps,
    listingRepo,
    eventRepo,
  };
}

async function login(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.data.token).toBeDefined();
  return res.body.data.token as string;
}

function seedDraftListing(
  listingRepo: InMemoryListingRepository,
  productId: string,
): string {
  const listing = unwrap(
    Listing.create({
      id: 'l-e2e-1',
      productId,
      marketplaceId: 'm-1',
      price: money(25, 'PLN'),
      status: 'draft',
    }),
  );
  listingRepo.items.set(listing.id, listing);
  return listing.id;
}

describe('E2E product/listing/Hermes flow (in-memory, no DB)', () => {
  it('logs in and returns the current principal via /auth/me', async () => {
    const { app } = await buildE2E();
    const token = await login(app);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data.email).toBe(DEMO_EMAIL);
    expect(me.body.data.workspaceId).toBe(WORKSPACE_ID);
  });

  it('creates a product then lists it back for the workspace', async () => {
    const { app } = await buildE2E();
    const token = await login(app);

    const create = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'SKU-1',
        name: 'Test Widget',
        description: 'A perfectly adequate widget for end-to-end testing.',
        costPrice: 10,
        sellingPrice: 20,
        condition: 'good',
        category: 'electronics',
      });

    expect(create.status).toBe(201);
    expect(create.body.success).toBe(true);
    const productId = create.body.data.id as string;
    expect(productId).toBeDefined();

    const list = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(productId);
  });

  it('publishes a listing and finalizes it live in the store (handler fix)', async () => {
    const { app, listingRepo } = await buildE2E();
    const token = await login(app);

    const create = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'SKU-2',
        name: 'Publishable Widget',
        description: 'A widget that we will publish to a marketplace end to end.',
        costPrice: 10,
        sellingPrice: 25,
        condition: 'good',
        category: 'electronics',
      });
    const productId = create.body.data.id as string;
    const listingId = seedDraftListing(listingRepo, productId);

    const publish = await request(app)
      .post(`/api/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(publish.status).toBe(200);
    expect(publish.body.success).toBe(true);

    // The synchronous queue ran the handler + domain finalizer: reading the listing
    // back must show it live with the external id and a publishedAt set.
    const read = await request(app)
      .get(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.data.status).toBe('live');
    expect(read.body.data.marketplaceListingId).toBe('olx-external-1');
    expect(read.body.data.publishedAt).toBeTruthy();
  });

  it('relist performs an actual republish (not a no-op) and finalizes live (C6)', async () => {
    const { app, listingRepo } = await buildE2E();
    const token = await login(app);

    const create = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'SKU-RELIST',
        name: 'Relistable Widget',
        description: 'A widget we will relist to a marketplace end to end.',
        costPrice: 10,
        sellingPrice: 25,
        condition: 'good',
        category: 'electronics',
      });
    const productId = create.body.data.id as string;
    const listingId = seedDraftListing(listingRepo, productId);

    const relist = await request(app)
      .post(`/api/listings/${listingId}/relist`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(relist.status).toBe(202);
    expect(relist.body.success).toBe(true);

    // The synchronous publish queue ran the real handler: the listing is now live
    // with an external id — proving relist actually republished rather than being
    // a no-op that only flips status.
    const read = await request(app)
      .get(`/api/listings/${listingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.body.data.status).toBe('live');
    expect(read.body.data.marketplaceListingId).toBe('olx-external-1');
  });

  it('relist rejects a sold product (invariant enforced) (C6)', async () => {
    const { app, listingRepo } = await buildE2E();
    const token = await login(app);

    const create = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'SKU-SOLD',
        name: 'Sold Widget',
        description: 'A widget that has been sold and must not be relisted.',
        costPrice: 10,
        sellingPrice: 25,
        condition: 'good',
        category: 'electronics',
      });
    const productId = create.body.data.id as string;
    const listingId = seedDraftListing(listingRepo, productId);

    // Move the product to sold (forward-only transition via the update endpoint).
    const sold = await request(app)
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'sold' });
    expect(sold.status).toBe(200);

    const relist = await request(app)
      .post(`/api/listings/${listingId}/relist`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(relist.status).toBe(422);
    expect(relist.body.success).toBe(false);
    expect(relist.body.error.code).toBe('INVALID_STATE');
  });

  it('runs Hermes for the workspace (endpoint returns 202)', async () => {
    const { app } = await buildE2E();
    const token = await login(app);

    const run = await request(app)
      .post('/api/hermes/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ trigger: 'manual' });

    expect(run.status).toBe(202);
    expect(run.body.success).toBe(true);
    expect(Array.isArray(run.body.data)).toBe(true);
  });

  it('approves a pending Hermes event and applies the change (verify applied)', async () => {
    const { app, eventRepo } = await buildE2E();
    const token = await login(app);

    const create = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'SKU-3',
        name: 'Old Name',
        description: 'A widget whose title Hermes will propose to improve for SEO.',
        costPrice: 10,
        sellingPrice: 20,
        condition: 'good',
        category: 'electronics',
      });
    const productId = create.body.data.id as string;

    // Seed a pending_review title-change event referencing the created product.
    const event = unwrap(
      HermesEvent.create({
        id: 'evt-e2e-1',
        workspaceId: WORKSPACE_ID,
        productId,
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Improve product title for SEO',
        proposedChange: {
          kind: 'title',
          field: 'title',
          from: 'Old Name',
          to: 'New Optimized Name',
        },
      }),
    );
    await eventRepo.save(event);

    const approve = await request(app)
      .post(`/api/hermes/events/${event.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(approve.status).toBe(200);
    expect(approve.body.success).toBe(true);
    expect(approve.body.data.status).toBe('applied');

    // The applied title change must be reflected on the product aggregate.
    const read = await request(app)
      .get(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.body.data.name).toBe('New Optimized Name');
  });
});
