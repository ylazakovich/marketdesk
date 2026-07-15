// Integration tests for the presentation layer, exercised with supertest against
// buildApp(deps). Application services are stubbed for deterministic Results; the
// focus is the HTTP contract: envelope shape (§18), auth, validation and error->status
// mapping (§5/§19).

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { buildApp, type AppDeps } from '../http/app';
import { validateBody } from '../http/middleware/ValidationMiddleware';
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
import type { MarketplaceOAuthService } from '../../application/services/MarketplaceOAuthService';
import type { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
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

function stubMarketplaceOAuthService(): MarketplaceOAuthService {
  const status = {
    connected: true,
    marketplaceId: 'marketplace-olx',
    providerKey: 'olx' as const,
    account: {
      id: 'account-1',
      handle: 'OLX account',
      status: 'connected' as const,
      scopes: ['basic'],
    },
    tokenExpiresAt: '2026-07-14T13:00:00.000Z',
    refreshable: true,
  };
  return {
    async start() {
      return {
        authorizationUrl: 'https://www.olx.pl/oauth/authorize?state=oauth-state',
        state: 'oauth-state',
        expiresAt: '2026-07-14T12:10:00.000Z',
      };
    },
    async complete() {
      return status;
    },
    async check() {
      return status;
    },
    async disconnect() {},
  } as unknown as MarketplaceOAuthService;
}

function stubMarketplaceImportService(): MarketplaceImportService {
  return {
    async preview() {
      return Ok({
        marketplaceId: 'marketplace-olx',
        marketplaceKey: 'olx' as const,
        readOnly: true as const,
        totals: { discovered: 1, new: 1, already_imported: 0, unsupported: 0 },
        items: [
          {
            status: 'new' as const,
            externalListingId: 'olx-1',
            externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
            title: 'Remote camera',
            remoteStatus: 'active',
            warnings: [],
            proposed: {
              externalListingId: 'olx-1',
              externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
              title: 'Remote camera',
              description: 'Existing OLX advert',
              price: 100,
              currency: 'PLN',
              status: 'live' as const,
              remoteStatus: 'active',
              category: 'electronics',
              imageUrls: ['https://img.example/1.jpg'],
            },
          },
        ],
      });
    },
  } as unknown as MarketplaceImportService;
}

async function buildTestApp() {
  const authUserStore = new InMemoryAuthStore();
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
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
    marketplaceOAuthService: stubMarketplaceOAuthService(),
    marketplaceSyncScheduler: { reconcile: async () => ({ mode: 'manual', scheduled: false }) },
    marketplaceImportService: stubMarketplaceImportService(),
    marketplaceOAuthReturnUrl: 'http://localhost:5173/marketplaces',
    workspaceRepo: workspaceRepo as IWorkspaceRepository,
    authUserStore,
    idGenerator: () => 'listing-1',
  };

  const cost = Money.of(10, 'PLN');
  const price = Money.of(20, 'PLN');
  if (cost.isErr() || price.isErr()) throw new Error('money fixture failed');
  const product = Product.create({
    id: 'p-real',
    workspaceId: 'ws-1',
    sku: 'S-REAL',
    name: 'Real widget',
    description: 'A real widget for listing and publish preview tests',
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
  return {
    app: buildApp(deps, { enableRateLimit: false }),
    authUserStore,
    marketplaceRepo,
    workspaceRepo,
    listingRepo,
  };
}

async function seedPreviewListing(listingRepo: InMemoryListingRepository): Promise<void> {
  const price = Money.of(20, 'PLN');
  if (price.isErr()) throw new Error('money fixture failed');
  const listing = Listing.create({
    id: 'listing-preview',
    productId: 'p-real',
    marketplaceId: 'marketplace-olx',
    price: price.value,
  });
  if (listing.isErr()) throw listing.error;
  await listingRepo.save(listing.value);
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

    it('provisions a disconnected OLX marketplace pending OAuth on register', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const res = await request(app).post('/api/auth/register').send({
        email: 'seller@example.com',
        password: 'secret123',
        workspaceName: 'Seller Workspace',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const workspaceId = res.body.data.user.workspaceId;
      expect(workspaceId).toBeDefined();

      const olx = await marketplaceRepo.findByKey(workspaceId, 'olx');
      expect(olx).not.toBeNull();
      expect(olx?.name).toBe('OLX');
      expect(olx?.isConnected()).toBe(false);
      expect(olx?.syncMode).toBe('manual');
    });

    it('cleans up provisioned workspace and marketplace if user creation fails', async () => {
      const { app, authUserStore, marketplaceRepo, workspaceRepo } = await buildTestApp();
      authUserStore.create = jest.fn(async () => {
        throw new Error('user create failed');
      });

      const res = await request(app).post('/api/auth/register').send({
        email: 'seller-fail@example.com',
        password: 'secret123',
        workspaceName: 'Failing Seller Workspace',
      });

      expect(res.status).toBe(500);
      expect(await workspaceRepo.findAll()).toHaveLength(0);
      expect(marketplaceRepo.items.size).toBe(1);
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

    it('creates a draft OLX listing for a product', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('listing-1');
      expect(res.body.data.productId).toBe('p-real');
      expect(res.body.data.marketplaceId).toBe('marketplace-olx');
      expect(res.body.data.price).toBe(20);
      expect(res.body.data.status).toBe('draft');
    });

    it('rejects duplicate listing creation for the same marketplace', async () => {
      const { app } = await buildTestApp();
      await auth(request(app).post('/api/products/p-real/listings')).send({ marketplaceKey: 'olx' });
      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rejects draft listing creation for a disconnected marketplace', async () => {
      const { app, marketplaceRepo } = await buildTestApp();
      const marketplace = await marketplaceRepo.findByKey('ws-1', 'olx');
      marketplace?.disconnect();

      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('maps concurrent duplicate listing persistence to a conflict response', async () => {
      const { app, listingRepo } = await buildTestApp();
      jest.spyOn(listingRepo, 'save').mockRejectedValueOnce({
        code: '23505',
        constraint: 'unique_listing',
      });

      const res = await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });
  });

  describe('marketplace OAuth', () => {
    it('starts OLX OAuth from an authenticated workspace without marking local success', async () => {
      const { app } = await buildTestApp();
      const res = await auth(
        request(app).post('/api/marketplaces/marketplace-olx/connect'),
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.authorizationUrl).toContain('https://www.olx.pl/oauth/authorize');
      expect(res.body.data.state).toBe('oauth-state');
    });

    it('accepts the provider callback without a bearer token and returns the API envelope', async () => {
      const { app } = await buildTestApp();
      const res = await request(app)
        .get('/api/marketplaces/olx/oauth/callback')
        .query({ code: 'authorization-code', state: 'oauth-state', response: 'json' })
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connected).toBe(true);
      expect(res.body.data.account.status).toBe('connected');
    });

    it('returns app-authoritative OLX account status from the protected check endpoint', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/marketplaces/marketplace-olx/check'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.connected).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('access-token');
      expect(JSON.stringify(res.body)).not.toContain('refresh-token');
    });

    it('previews existing OLX adverts through a read-only import endpoint', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/marketplaces/marketplace-olx/import-preview')).send({
        statuses: ['active'],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.readOnly).toBe(true);
      expect(res.body.data.totals).toEqual({ discovered: 1, new: 1, already_imported: 0, unsupported: 0 });
      expect(res.body.data.items[0]).toMatchObject({
        status: 'new',
        externalListingId: 'olx-1',
        remoteStatus: 'active',
      });
    });
  });

  describe('listings', () => {
    it('returns publish preview without publishing or enqueueing', async () => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);
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
      await seedPreviewListing(listingRepo);
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
      await seedPreviewListing(listingRepo);
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

    it('dismisses a pending event without requiring an explicit JSON body', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/pending/dismiss'));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('preserves explicit null bodies as validation failures', () => {
      const schema = z.object({ actorId: z.string().optional() });
      const req = { body: null } as any;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;
      const next = jest.fn();

      validateBody(schema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        }),
      );
      expect(next).not.toHaveBeenCalled();
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
