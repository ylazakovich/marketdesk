// Integration tests for the presentation layer, exercised with supertest against
// buildApp(deps). Application services are stubbed for deterministic Results; the
// focus is the HTTP contract: envelope shape (§18), auth, validation and error->status
// mapping (§5/§19).

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { buildApp, type AppDeps } from '../http/app';
import { signToken } from '../http/middleware/AuthMiddleware';
import type {
  IAuthUserStore,
  AuthUserRecord,
  CreateAuthUserInput,
} from '../http/ports/IAuthUserStore';
import { Ok, Err } from '../../domain/shared/Result';
import { InvalidStateError, NotFoundError } from '../../domain/shared/DomainError';
import { Product } from '../../domain/entities/Product';
import { Marketplace } from '../../domain/entities/Marketplace';
import { Listing } from '../../domain/entities/Listing';
import { Money } from '../../domain/valueObjects/Money';
import type { ProductApplicationService } from '../../application/services/ProductApplicationService';
import type { ListingApplicationService } from '../../application/services/ListingApplicationService';
import type { HermesApplicationService } from '../../application/services/HermesApplicationService';
import type { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { ProductView, HermesEventView } from '../../application/dto/presenters';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
} from '../../domain/testkit/support';
import { InMemoryWorkspaceRepository } from '../../application/testkit/support';

const iso = new Date().toISOString();

const productView: ProductView = {
  id: 'p1',
  workspaceId: 'ws-1',
  sku: 'S1',
  name: 'Widget',
  description: 'A widget',
  costPrice: 10,
  sellingPrice: 20,
  condition: 'good',
  category: 'misc',
  status: 'active',
  tags: [],
  images: [],
  createdAt: iso,
  updatedAt: iso,
};

const appliedEvent: HermesEventView = {
  id: 'applied',
  workspaceId: 'ws-1',
  type: 'suggested_lower_price',
  severity: 'info',
  status: 'applied',
  title: 'Applied change',
  proposedChange: null,
  createdAt: iso,
};

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

function stubProductService(): ProductApplicationService {
  return {
    async listProducts() {
      return Ok({ items: [productView], total: 1, page: 1, limit: 20, totalPages: 1 });
    },
    async getProduct(id: string) {
      return id === 'p1' ? productView : null;
    },
    async createProduct(dto: unknown) {
      return Ok({ ...productView, ...(dto as object) });
    },
    async updateProduct() {
      return Ok(productView);
    },
  } as unknown as ProductApplicationService;
}

function stubHermesService(): HermesApplicationService {
  return {
    async listEvents() {
      return { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    },
    async getEvent(id: string) {
      return id === 'e1' ? appliedEvent : null;
    },
    async approveEvent({ eventId }: { eventId: string }) {
      if (eventId === 'pending') {
        return Ok({ ...appliedEvent, id: 'pending', status: 'applied' as const });
      }
      if (eventId === 'applied') {
        return Err(new InvalidStateError('Event is not pending review'));
      }
      return Err(new NotFoundError(`Hermes event not found: ${eventId}`));
    },
    async dismissEvent() {
      return Ok(appliedEvent);
    },
    async runHermes() {
      return Ok([]);
    },
  } as unknown as HermesApplicationService;
}

function stubListingService(): ListingApplicationService {
  return {
    async listByWorkspace() {
      return { items: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    },
    async listByProduct() {
      return [];
    },
    async getListing() {
      return null;
    },
    async publishListing() {
      return Ok({});
    },
    async syncMarketplace() {
      return Ok({ marketplaceId: 'm1', enqueued: true, externalListingCount: 0 });
    },
  } as unknown as ListingApplicationService;
}

function stubAnalyticsService(): AnalyticsApplicationService {
  return {
    async getDashboardMetrics() {
      return { workspaceId: 'ws-1' };
    },
    async getListingPerformance() {
      return [];
    },
  } as unknown as AnalyticsApplicationService;
}

async function buildTestApp() {
  const authUserStore = new InMemoryAuthStore();
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const passwordHash = await bcrypt.hash('secret123', 4);
  authUserStore.users.push({
    id: 'u-1',
    email: 'demo@example.com',
    passwordHash,
    workspaceId: 'ws-1',
    createdAt: new Date(),
  });

  const deps: AppDeps = {
    productService: stubProductService(),
    listingService: stubListingService(),
    hermesService: stubHermesService(),
    analyticsService: stubAnalyticsService(),
    productRepo: productRepo as IProductRepository,
    listingRepo: listingRepo as IListingRepository,
    marketplaceRepo: marketplaceRepo as IMarketplaceRepository,
    workspaceRepo: new InMemoryWorkspaceRepository() as IWorkspaceRepository,
    authUserStore,
  };

  const cost = Money.of(10, 'PLN');
  const price = Money.of(20, 'PLN');
  if (cost.isErr() || price.isErr()) throw new Error('money fixture failed');
  const product = Product.create({
    id: 'p-real',
    workspaceId: 'ws-1',
    sku: 'S-REAL',
    name: 'Real widget',
    description: 'A real widget for publish preview tests',
    costPrice: cost.value,
    sellingPrice: price.value,
    condition: 'good',
    category: 'misc',
    status: 'active',
  });
  if (product.isErr()) throw product.error;
  await productRepo.save(product.value);
  const marketplace = Marketplace.create({
    id: 'marketplace-olx',
    workspaceId: 'ws-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
  });
  if (marketplace.isErr()) throw marketplace.error;
  await marketplaceRepo.save(marketplace.value);
  const listing = Listing.create({
    id: 'listing-preview',
    productId: 'p-real',
    marketplaceId: 'marketplace-olx',
    price: price.value,
  });
  if (listing.isErr()) throw listing.error;
  await listingRepo.save(listing.value);

  return { app: buildApp(deps, { enableRateLimit: false }), authUserStore, listingRepo, marketplaceRepo };
}

const token = signToken({ userId: 'u-1', workspaceId: 'ws-1' });
const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('Presentation API', () => {
  describe('auth', () => {
    it('logs in with valid credentials and returns a token', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'secret123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.token).toBe('string');
      expect(res.body.data.user.workspaceId).toBe('ws-1');
    });

    it('rejects invalid credentials with a 401 error envelope', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'demo@example.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an unknown email with the same 401 envelope (S6 constant-time path)', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      // Same uniform message as the wrong-password path (no user enumeration).
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('products', () => {
    it('returns 401 when unauthenticated', async () => {
      const { app } = await buildTestApp();
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns the §18 paginated envelope on list', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/products'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns a VALIDATION_ERROR envelope with field details on invalid create', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products')).send({
        name: 'x',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(res.body.error.details[0]).toHaveProperty('field');
      expect(res.body.error.details[0]).toHaveProperty('message');
    });

    it('creates a product and returns 201 with the success envelope', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products')).send({
        sku: 'S1',
        name: 'Widget',
        description: 'A nice widget for testing',
        costPrice: 10,
        sellingPrice: 20,
        condition: 'good',
        category: 'misc',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
    });
  });

  describe('listings', () => {
    it('returns publish preview without publishing or enqueueing', async () => {
      const { app, listingRepo } = await buildTestApp();
      const before = await listingRepo.findById('listing-preview');
      const res = await auth(request(app).post('/api/listings/listing-preview/publish-preview')).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.canPublish).toBe(true);
      expect(res.body.data.payload.productName).toBe('Real widget');
      expect(res.body.data.payload.price).toBe(20);
      expect(before?.status).toBe('draft');
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('supports dryRun on the publish endpoint without publishing', async () => {
      const { app, listingRepo } = await buildTestApp();
      const res = await auth(request(app).post('/api/listings/listing-preview/publish')).send({
        dryRun: true,
      });
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.canPublish).toBe(true);
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('returns publish preview warnings without publishing invalid listings', async () => {
      const { app, listingRepo, marketplaceRepo } = await buildTestApp();
      const marketplace = await marketplaceRepo.findById('marketplace-olx');
      marketplace?.disconnect();

      const res = await auth(request(app).post('/api/listings/listing-preview/publish-preview')).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings.length).toBeGreaterThan(0);
      expect(res.body.data.warnings[0]).toContain('not connected');
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });
  });

  describe('hermes', () => {
    it('approves a pending event (happy path)', async () => {
      const { app } = await buildTestApp();
      const res = await auth(
        request(app).post('/api/hermes/events/pending/approve'),
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('applied');
    });

    it('returns 422 when approving a non-pending event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(
        request(app).post('/api/hermes/events/applied/approve'),
      ).send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('returns a 404 error envelope for an unknown event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events/nope'));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('unmatched routes', () => {
    it('returns a 404 envelope for unknown /api routes', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/does-not-exist'));
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
