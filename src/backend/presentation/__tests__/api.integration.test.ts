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
import { Workspace } from '../../domain/entities/Workspace';
import { Listing } from '../../domain/entities/Listing';
import { Money } from '../../domain/valueObjects/Money';
import type { ProductApplicationService } from '../../application/services/ProductApplicationService';
import type { ListingApplicationService } from '../../application/services/ListingApplicationService';
import type { HermesApplicationService } from '../../application/services/HermesApplicationService';
import type { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import type { MarketplaceOAuthService } from '../../application/services/MarketplaceOAuthService';
import type { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import type { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';
import type { CategoryCorrectionOperationService } from '../../application/services/CategoryCorrectionOperationService';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { ProductView, HermesEventView } from '../../application/dto/presenters';
import { HERMES_EVENT_STATUSES, type MarketplaceCategoryMetadata } from '../../../shared/types';
import type { ListingStatus } from '../../domain/valueObjects/ListingStatus';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
} from '../../domain/testkit/support';
import { InMemoryWorkspaceRepository } from '../../application/testkit/support';
import { InMemorySettingsRepository } from '../../infrastructure/persistence/repositories/InMemorySettingsRepository';

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
    async listEvents(query: { productId?: string }) {
      const items = query.productId
        ? query.productId === 'p1'
          ? [{ ...appliedEvent, productId: 'p1' }]
          : []
        : HERMES_EVENT_STATUSES.map((status) => ({
            ...appliedEvent,
            id: status,
            status,
          }));
      return { items, total: items.length, page: 1, limit: 20, totalPages: items.length ? 1 : 0 };
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
    async relistListing() {
      return Err(new InvalidStateError('Only expired or error listings may be relisted'));
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
    async getAppCredentialStatus() {
      return {
        configured: true,
        marketplaceId: 'marketplace-olx',
        providerKey: 'olx' as const,
      };
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
        totals: {
          discovered: 1,
          new: 1,
          already_imported: 0,
          changed: 0,
          unsupported: 0,
          failed: 0,
        },
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
    async import() {
      return Ok({
        marketplaceId: 'marketplace-olx',
        marketplaceKey: 'olx' as const,
        imported: 1,
        updated: 0,
        skipped: 0,
        failed: 0,
        results: [
          {
            externalListingId: 'olx-1',
            status: 'imported' as const,
            productId: 'product-imported',
            listingId: 'listing-imported',
          },
        ],
      });
    },
  } as unknown as MarketplaceImportService;
}

function stubOlxPublicationQuotaService(): OlxPublicationQuotaService {
  const quota = {
    id: 'quota-1',
    workspaceId: 'ws-1',
    marketplaceId: 'marketplace-olx',
    marketplaceAccountId: 'account-1',
    subcategoryId: '2000',
    cycleStartedAt: '2026-07-01T00:00:00.000Z',
    cycleEndsAt: '2026-08-01T00:00:00.000Z',
    publicationLimit: 2,
    consumed: 1,
    remaining: 1,
    source: 'operator' as const,
    confidence: 'verified' as const,
    verifiedAt: '2026-07-14T00:00:00.000Z',
    staleAt: '2026-07-20T00:00:00.000Z',
    isStale: false,
    status: 'available' as const,
  };
  return {
    async list() {
      return [quota];
    },
    async set(input) {
      return {
        ...quota,
        workspaceId: input.workspaceId,
        marketplaceId: input.marketplaceId,
        actorId: input.actorId,
      };
    },
    async preview() {
      return {
        applicable: true,
        marketplaceKey: 'olx' as const,
        marketplaceAccountId: 'account-1',
        subcategoryId: '2000',
        status: 'available' as const,
        decision: 'allow' as const,
        reason: 'free_unit_available',
        requiresOverride: false,
        quota,
      };
    },
  } as unknown as OlxPublicationQuotaService;
}

function stubUnknownOlxPublicationQuotaService(): OlxPublicationQuotaService {
  return {
    async preview() {
      return {
        applicable: true,
        marketplaceKey: 'olx' as const,
        marketplaceAccountId: 'account-1',
        subcategoryId: '2000',
        status: 'unknown' as const,
        decision: 'block' as const,
        reason: 'quota_unknown',
        requiresOverride: true,
      };
    },
  } as unknown as OlxPublicationQuotaService;
}

function stubCategoryCorrectionOperationService(): CategoryCorrectionOperationService {
  const base = {
    id: 'recreate-1',
    workspaceId: 'ws-1',
    recommendationEventId: 'e1',
    listingId: 'listing-1',
    marketplaceId: 'marketplace-olx',
    kind: 'recreate' as const,
    state: 'requested' as const,
    targetCategory: null,
    paidOverrideReason: null,
    requestedBy: null,
    approvedBy: null,
    result: null,
    requestedAt: new Date(),
    approvedAt: null,
    executedAt: null,
    failedAt: null,
    updatedAt: new Date(),
  };
  return {
    async requestStandaloneDelist(input: {
      operationId: string;
      listingId: string;
      workspaceId: string;
      actorId: string;
    }) {
      return {
        ...base,
        id: input.operationId,
        listingId: input.listingId,
        workspaceId: input.workspaceId,
        recommendationEventId: null,
        kind: 'delist' as const,
        requestedBy: input.actorId,
      };
    },
    async list(_eventId: string, workspaceId: string) {
      return [{ ...base, workspaceId }];
    },
    async approve(input: {
      operationId: string;
      workspaceId: string;
      actorId: string;
      paidOverrideReason?: string;
    }) {
      return {
        ...base,
        id: input.operationId,
        workspaceId: input.workspaceId,
        state: 'approved' as const,
        approvedBy: input.actorId,
        paidOverrideReason: input.paidOverrideReason ?? null,
        approvedAt: new Date(),
      };
    },
    async execute(input: { operationId: string; workspaceId: string }) {
      return {
        ...base,
        id: input.operationId,
        workspaceId: input.workspaceId,
        state: 'executed' as const,
        result: { externalListingId: 'new-advert' },
        approvedAt: new Date(),
        executedAt: new Date(),
      };
    },
  } as unknown as CategoryCorrectionOperationService;
}

async function buildTestApp(
  options: {
    olxPublicationQuotaService?: OlxPublicationQuotaService;
    disableOlxPublicationQuotaService?: boolean;
    applicationVersion?: string;
    seedWorkspace?: boolean;
  } = {}
) {
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
    olxPublicationQuotaService: options.disableOlxPublicationQuotaService
      ? undefined
      : (options.olxPublicationQuotaService ?? stubOlxPublicationQuotaService()),
    categoryCorrectionOperationService: stubCategoryCorrectionOperationService(),
    marketplaceOAuthReturnUrl: 'http://localhost:5173/marketplaces',
    workspaceRepo: workspaceRepo as IWorkspaceRepository,
    settingsRepo: new InMemorySettingsRepository(),
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
  if (options.seedWorkspace) {
    const workspace = Workspace.create({ id: 'ws-1', name: 'Demo workspace' });
    if (workspace.isErr()) throw workspace.error;
    await workspaceRepo.save(workspace.value);
  }
  return {
    app: buildApp(deps, {
      enableRateLimit: false,
      applicationVersion: options.applicationVersion,
    }),
    authUserStore,
    marketplaceRepo,
    workspaceRepo,
    listingRepo,
  };
}

async function seedPreviewListing(
  listingRepo: InMemoryListingRepository,
  category?: MarketplaceCategoryMetadata | null,
  status?: ListingStatus
): Promise<void> {
  const price = Money.of(20, 'PLN');
  if (price.isErr()) throw new Error('money fixture failed');
  const listing = Listing.create({
    id: 'listing-preview',
    productId: 'p-real',
    marketplaceId: 'marketplace-olx',
    price: price.value,
    status,
    marketplaceCategory:
      category === undefined
        ? {
            providerCategoryId: '2000',
            name: 'Widgets',
            path: ['Home', 'Tools', 'Widgets'],
            source: 'provider_taxonomy',
            confidence: 1,
            isLeaf: true,
            taxonomyVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
            taxonomyStaleAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
          }
        : category,
  });
  if (listing.isErr()) throw listing.error;
  await listingRepo.save(listing.value);
}

const token = signToken({ userId: 'u-1', workspaceId: 'ws-1' });
const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('Presentation API', () => {
  describe('application information', () => {
    it('returns the running artifact version publicly without Git metadata', async () => {
      const { app } = await buildTestApp({ applicationVersion: 'v0.10.0' });

      const res = await request(app).get('/api/application-info');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { version: 'v0.10.0' } });
      expect(JSON.stringify(res.body)).not.toMatch(/commit|sha|branch|dirty/i);
    });

    it('returns an honest development fallback when release metadata is absent', async () => {
      const { app } = await buildTestApp();

      const res = await request(app).get('/api/application-info');

      expect(res.status).toBe(200);
      expect(res.body.data.version).toBe('Development');
    });
  });

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

    it('requires explicit API confirmation before creating below-cost pricing', async () => {
      const { app } = await buildTestApp();
      const body = {
        sku: 'BELOW-1',
        name: 'Below-cost widget',
        description: 'A deliberately discounted widget for boundary testing',
        costPrice: 20,
        sellingPrice: 10,
        condition: 'good',
        category: 'misc',
      };

      const rejected = await auth(request(app).post('/api/products')).send(body);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
      expect(rejected.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'allowBelowCost',
            message: expect.stringContaining('must be true'),
          }),
        ])
      );

      const accepted = await auth(request(app).post('/api/products')).send({
        ...body,
        allowBelowCost: true,
      });
      expect(accepted.status).toBe(201);
      expect(accepted.body.data.sellingPrice).toBe(10);
    });

    it('generates a review-only AI product draft from a title', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'title',
        title: 'Vintage Canon camera',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.mode).toBe('title');
      expect(res.body.data.fields.name).toBe('Vintage Canon camera');
      expect(res.body.data.fields.status).toBe('draft');
      expect(res.body.data.uncertainFields).toContain('sellingPrice');
      expect(res.body.data.notes.join(' ')).toContain('normal confirmation flow');
    });

    it('validates empty photo-first AI product draft requests', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'photos',
        imageUrls: [],
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('falls back to existing product images for photo-first AI draft requests', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/products/ai-draft')).send({
        mode: 'photos',
        imageUrls: [],
        existingFields: {
          name: 'Vintage camera',
          images: ['https://example.test/camera.jpg'],
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fields.images).toEqual(['https://example.test/camera.jpg']);
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
      await auth(request(app).post('/api/products/p-real/listings')).send({
        marketplaceKey: 'olx',
      });
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
      const res = await auth(request(app).post('/api/marketplaces/marketplace-olx/connect')).send(
        {}
      );

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
      const res = await auth(
        request(app).post('/api/marketplaces/marketplace-olx/import-preview')
      ).send({
        statuses: ['active'],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.readOnly).toBe(true);
      expect(res.body.data.totals).toEqual({
        discovered: 1,
        new: 1,
        already_imported: 0,
        changed: 0,
        unsupported: 0,
        failed: 0,
      });
      expect(res.body.data.items[0]).toMatchObject({
        status: 'new',
        externalListingId: 'olx-1',
        remoteStatus: 'active',
      });
    });

    it('imports selected OLX adverts only after an explicit import request', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/marketplaces/marketplace-olx/import')).send({
        externalListingIds: ['olx-1'],
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ imported: 1, updated: 0, skipped: 0, failed: 0 });
      expect(res.body.data.results[0]).toMatchObject({
        externalListingId: 'olx-1',
        status: 'imported',
        productId: 'product-imported',
        listingId: 'listing-imported',
      });
    });
    it('reads and validates authenticated OLX quota operator contracts', async () => {
      const { app } = await buildTestApp();
      const read = await auth(request(app).get('/api/marketplaces/marketplace-olx/quotas'));
      const update = await auth(request(app).put('/api/marketplaces/marketplace-olx/quotas')).send({
        workspaceId: 'ws-attacker',
        marketplaceId: 'marketplace-attacker',
        actorId: 'user-attacker',
        subcategoryId: '2000',
        cycleStartedAt: '2026-07-01T00:00:00.000Z',
        cycleEndsAt: '2026-08-01T00:00:00.000Z',
        publicationLimit: 2,
        consumed: 1,
        source: 'operator',
        confidence: 'verified',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        staleAt: '2026-07-20T00:00:00.000Z',
      });

      expect(read.status).toBe(200);
      expect(read.body.data[0]).toMatchObject({ subcategoryId: '2000', remaining: 1 });
      expect(update.status).toBe(200);
      expect(update.body.data).toMatchObject({
        publicationLimit: 2,
        consumed: 1,
        source: 'operator',
        confidence: 'verified',
        workspaceId: 'ws-1',
        marketplaceId: 'marketplace-olx',
        actorId: 'u-1',
      });
    });
  });

  describe('listings', () => {
    it('returns publish preview without publishing or enqueueing', async () => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);
      const before = await listingRepo.findById('listing-preview');
      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.canPublish).toBe(true);
      expect(res.body.data.quotaOverrideEligibility).toEqual({ eligible: false, reason: null });
      expect(res.body.data.quotaDecision).toMatchObject({
        status: 'available',
        decision: 'allow',
        subcategoryId: '2000',
        quota: {
          publicationLimit: 2,
          consumed: 1,
          remaining: 1,
          source: 'operator',
          confidence: 'verified',
          isStale: false,
        },
      });
      expect(res.body.data.payload.productName).toBe('Real widget');
      expect(res.body.data.payload.price).toBe(20);
      expect(res.body.data.marketplaceCategory).toEqual(
        expect.objectContaining({
          providerCategoryId: '2000',
          path: ['Home', 'Tools', 'Widgets'],
        })
      );
      expect(res.body.data.payload.marketplaceCategory).toEqual(res.body.data.marketplaceCategory);
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

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});
      const after = await listingRepo.findById('listing-preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings.length).toBeGreaterThan(0);
      expect(res.body.data.warnings[0]).toContain('not connected');
      expect(after?.status).toBe('draft');
      expect(after?.marketplaceListingId).toBeNull();
    });

    it('exposes quota override eligibility only when quota is the sole blocker', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(['OLX quota blocks publication: quota_unknown']);
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: true,
        reason: 'quota_unknown',
      });
    });

    it('does not expose quota override eligibility when another publish blocker exists', async () => {
      const { app, listingRepo, marketplaceRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo);
      const marketplace = await marketplaceRepo.findById('marketplace-olx');
      marketplace?.disconnect();

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('not connected'),
          'OLX quota blocks publication: quota_unknown',
        ])
      );
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_unknown',
      });
    });

    it('does not expose quota override eligibility when exact category metadata is missing', async () => {
      const { app, listingRepo } = await buildTestApp({
        olxPublicationQuotaService: stubUnknownOlxPublicationQuotaService(),
      });
      await seedPreviewListing(listingRepo, null);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining([
          'Select an exact OLX leaf category before publishing',
          'OLX quota blocks publication: quota_unknown',
        ])
      );
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_unknown',
      });
    });

    it('does not expose an override when the quota guard itself is unavailable', async () => {
      const { app, listingRepo } = await buildTestApp({ disableOlxPublicationQuotaService: true });
      await seedPreviewListing(listingRepo);

      const res = await auth(
        request(app).post('/api/listings/listing-preview/publish-preview')
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.data.canPublish).toBe(false);
      expect(res.body.data.quotaOverrideEligibility).toEqual({
        eligible: false,
        reason: 'quota_guard_unavailable',
      });
    });

    it.each([
      [
        'confirmation is false',
        { confirmed: false, reason: 'This must not bypass the quota guard' },
      ],
      ['reason is missing', { confirmed: true }],
      ['reason is blank', { confirmed: true, reason: '   ' }],
      ['reason is too short', { confirmed: true, reason: 'too short' }],
      ['reason is too long', { confirmed: true, reason: 'x'.repeat(501) }],
    ])('rejects quota override when %s', async (_case, quotaOverride) => {
      const { app, listingRepo } = await buildTestApp();
      await seedPreviewListing(listingRepo);

      const res = await auth(request(app).post('/api/listings/listing-preview/publish')).send({
        quotaOverride,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each(['draft', 'live'] as const)(
      'rejects direct relist for a %s listing even with an explicit quota override',
      async (status) => {
        const { app, listingRepo } = await buildTestApp();
        await seedPreviewListing(listingRepo, undefined, status);

        const res = await auth(request(app).post('/api/listings/listing-preview/relist')).send({
          quotaOverride: {
            confirmed: true,
            reason: 'Accept possible OLX publication fee',
          },
        });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('INVALID_STATE');
      }
    );
  });

  describe('hermes', () => {
    it('serializes every canonical lifecycle status without label translation', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events'));

      expect(res.status).toBe(200);
      expect(res.body.data.map((event: HermesEventView) => event.status)).toEqual(
        HERMES_EVENT_STATUSES
      );
    });

    it('passes the product filter to the Hermes event query', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events?productId=p1'));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ productId: 'p1' });
    });

    it('approves a pending event (happy path)', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/pending/approve')).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('applied');
    });

    it('returns 422 when approving a non-pending event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).post('/api/hermes/events/applied/approve')).send({});

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
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('exposes separate authenticated list, approve, and execute operation workflows', async () => {
      const { app } = await buildTestApp();
      const unauthenticated = await request(app).get(
        '/api/hermes/events/e1/category-correction-operations'
      );
      expect(unauthenticated.status).toBe(401);

      const listed = await auth(
        request(app).get('/api/hermes/events/e1/category-correction-operations')
      );
      expect(listed.status).toBe(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({ id: 'recreate-1', kind: 'recreate', state: 'requested' }),
      ]);

      const approved = await auth(
        request(app).post('/api/hermes/category-correction-operations/recreate-1/approve')
      ).send({ paidOverrideReason: 'Operator accepts possible paid placement' });
      expect(approved.status).toBe(200);
      expect(approved.body.data).toMatchObject({ state: 'approved', approvedBy: 'u-1' });

      const executed = await auth(
        request(app).post('/api/hermes/category-correction-operations/recreate-1/execute')
      ).send({});
      expect(executed.status).toBe(200);
      expect(executed.body.data).toMatchObject({
        state: 'executed',
        result: { externalListingId: 'new-advert' },
      });
    });

    it('requires authentication and literal destructive confirmation for standalone listing delist', async () => {
      const { app } = await buildTestApp();
      const operationId = '8f620660-cafe-4f08-9f7f-60ea44c4ad58';

      const unauthenticated = await request(app)
        .post('/api/listings/listing-1/delist-to-draft')
        .send({ operationId, confirmed: true });
      expect(unauthenticated.status).toBe(401);

      const unconfirmed = await auth(
        request(app).post('/api/listings/listing-1/delist-to-draft'),
      ).send({ operationId, confirmed: false });
      expect(unconfirmed.status).toBe(400);

      const executed = await auth(
        request(app).post('/api/listings/listing-1/delist-to-draft'),
      ).send({ operationId, confirmed: true });
      expect(executed.status).toBe(200);
      expect(executed.body.data).toMatchObject({ id: operationId, state: 'executed' });
    });

    it('returns a 404 error envelope for an unknown event', async () => {
      const { app } = await buildTestApp();
      const res = await auth(request(app).get('/api/hermes/events/nope'));

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('persistent settings contracts', () => {
    it('round-trips principal-scoped workspace, preferences, notifications, and Hermes settings', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });

      const workspace = await auth(request(app).patch('/api/settings/workspace')).send({
        name: 'Polish shop',
        currency: 'EUR',
        timezone: 'Europe/Warsaw',
        language: 'pl',
      });
      expect(workspace.status).toBe(200);
      expect(workspace.body.data).toMatchObject({
        name: 'Polish shop',
        currency: 'EUR',
        language: 'pl',
      });

      const preferences = await auth(request(app).patch('/api/settings/preferences')).send({
        themeMode: 'dark',
        density: 'compact',
      });
      expect(preferences.body.data).toMatchObject({
        themeMode: 'dark',
        density: 'compact',
        revision: 1,
      });

      const notifications = await auth(request(app).patch('/api/settings/notifications')).send({
        events: { new_sale: { telegram: true, email: false } },
      });
      expect(notifications.body.data.events.new_sale).toEqual({
        email: false,
        inApp: true,
        telegram: true,
      });

      const hermes = await auth(request(app).patch('/api/settings/hermes')).send({
        autonomyLevel: 'balanced',
        guardrails: { maxAutoPriceChangePct: 5 },
      });
      expect(hermes.status).toBe(200);
      expect(hermes.body.data).toMatchObject({
        autonomyLevel: 'balanced',
        guardrails: { maxAutoPriceChangePct: 5 },
      });
    });

    it('rejects empty and unknown patches with structured validation details', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      for (const body of [{}, { token: 'must-not-be-accepted' }]) {
        const response = await auth(request(app).patch('/api/settings/preferences')).send(body);
        expect(response.status).toBe(400);
        expect(response.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(response.body.error.details).toEqual(expect.any(Array));
      }
    });

    it('preserves independent workspace and Hermes fields across concurrent PATCH requests', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });

      const [profile, hermes] = await Promise.all([
        auth(request(app).patch('/api/settings/workspace')).send({ name: 'Concurrent name' }),
        auth(request(app).patch('/api/settings/hermes')).send({
          guardrails: { autoRelist: true },
        }),
      ]);

      expect(profile.status).toBe(200);
      expect(hermes.status).toBe(200);
      const [savedProfile, savedHermes] = await Promise.all([
        auth(request(app).get('/api/settings/workspace')),
        auth(request(app).get('/api/settings/hermes')),
      ]);
      expect(savedProfile.body.data.name).toBe('Concurrent name');
      expect(savedHermes.body.data.guardrails.autoRelist).toBe(true);
    });

    it.each([
      ['deleted', 401],
      ['reassigned', 403],
    ] as const)(
      'rejects stale JWT authority when the current user is %s',
      async (state, expectedStatus) => {
        const { app, authUserStore } = await buildTestApp({ seedWorkspace: true });
        if (state === 'deleted') authUserStore.users.splice(0);
        else authUserStore.users[0]!.workspaceId = 'ws-other';

        const requests = [
          auth(request(app).get('/api/settings/preferences')),
          auth(request(app).patch('/api/settings/workspace')).send({ name: 'blocked' }),
          auth(request(app).patch('/api/settings/hermes')).send({ autonomyLevel: 'balanced' }),
          auth(request(app).get('/api/settings/integrations')),
          auth(request(app).patch('/api/workspaces/foreign-id')).send({ name: 'blocked' }),
        ];
        const responses = await Promise.all(requests);
        expect(responses.map((response) => response.status)).toEqual(
          Array(requests.length).fill(expectedStatus)
        );
      }
    );

    it('legacy workspace PATCH preserves settings fields omitted from its body', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      expect(
        (await auth(request(app).patch('/api/settings/workspace')).send({ currency: 'EUR' })).status
      ).toBe(200);

      const legacy = await auth(request(app).patch('/api/workspaces/ignored')).send({
        name: 'Legacy rename',
      });

      expect(legacy.status).toBe(200);
      expect(legacy.body.data).toMatchObject({ name: 'Legacy rename', currency: 'EUR' });
    });

    it('returns redacted integration configuration without connection or credential fields', async () => {
      const { app } = await buildTestApp({ seedWorkspace: true });
      const response = await auth(request(app).get('/api/settings/integrations'));
      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual(
        expect.arrayContaining([
          {
            category: 'marketplace',
            id: 'marketplace-olx',
            providerKey: 'olx',
            name: 'OLX',
            available: true,
            configured: true,
          },
          {
            category: 'telegram',
            id: 'telegram',
            name: 'Telegram',
            available: false,
            configured: false,
          },
          {
            category: 'api_keys',
            id: 'api_keys',
            name: 'API keys',
            available: true,
            configured: false,
            apiKeySummary: { total: 0, active: 0, revoked: 0 },
          },
        ])
      );
      expect(
        response.body.data.items.map((item: { category: string }) => item.category).sort()
      ).toEqual(['api_keys', 'marketplace', 'telegram']);
      expect(JSON.stringify(response.body)).not.toMatch(
        /token|secret|hash|credentials|connected|access[_-]?key|private[_-]?key/i
      );
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
