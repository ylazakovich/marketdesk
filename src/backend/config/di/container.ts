// Composition root (DI container) — ARCHITECTURE.md §5.
//
// This is the ONE place permitted to import concrete implementations from every
// layer (config, infrastructure, domain, application, presentation) and wire the
// full object graph in dependency order. No other module crosses layers.
//
// The graph is constructed with plain factory functions (no heavy DI framework):
// each dependency is instantiated once, in order, and passed explicitly to its
// consumers. Connection-bearing boundaries (pg Pool, Redis, the Bull queues, the
// AI completion client and the event broker) are injectable via ContainerOverrides
// so the graph can be built and asserted without any live infrastructure (see the
// container unit test). Absent overrides, the real config-backed clients are used.

import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Redis } from 'ioredis';

import { createPool } from '../database';
import { createRedisClient } from '../redis';

// --- Infrastructure: persistence ---
import { ProductRepository } from '../../infrastructure/persistence/repositories/ProductRepository';
import { ListingRepository } from '../../infrastructure/persistence/repositories/ListingRepository';
import { MarketplaceRepository } from '../../infrastructure/persistence/repositories/MarketplaceRepository';
import { MarketplaceAccountRepository } from '../../infrastructure/persistence/repositories/MarketplaceAccountRepository';
import { MarketplaceAppCredentialRepository } from '../../infrastructure/persistence/repositories/MarketplaceAppCredentialRepository';
import { PublishAttemptRepository } from '../../infrastructure/persistence/repositories/PublishAttemptRepository';
import { EventRepository } from '../../infrastructure/persistence/repositories/EventRepository';
import { WorkspaceRepository } from '../../infrastructure/persistence/repositories/WorkspaceRepository';
import { SettingsRepository } from '../../infrastructure/persistence/repositories/SettingsRepository';
import { ActivityLogRepository } from '../../infrastructure/persistence/repositories/ActivityLogRepository';
import { AnalyticsEventRepository } from '../../infrastructure/persistence/repositories/AnalyticsEventRepository';
import { AuthUserRepository } from '../../infrastructure/persistence/repositories/AuthUserRepository';
import { PriceHistoryRepository } from '../../infrastructure/persistence/repositories/PriceHistoryRepository';
import { OlxPublicationQuotaRepository } from '../../infrastructure/persistence/repositories/OlxPublicationQuotaRepository';
import { CategoryCorrectionOperationRepository } from '../../infrastructure/persistence/repositories/CategoryCorrectionOperationRepository';

async function withPoolTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Preserve the original transaction failure; rollback failure is secondary.
      releaseError =
        rollbackError instanceof Error ? rollbackError : new Error('Transaction rollback failed');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

// --- Infrastructure: events, cache, jobs, adapters, external ---
import {
  createRedisEventBroker,
  createEventPublisher,
  createRedisCache,
} from '../../infrastructure/eventBroker/RedisWiring';
import type {
  EventBroker,
  EventSubscriber,
} from '../../infrastructure/eventBroker/RedisEventBroker';
import type { RedisCache } from '../../infrastructure/cache/RedisCache';
import { BullJobQueue } from '../../infrastructure/jobQueue/BullJobQueue';
import { MarketplaceAdapterFactory } from '../../infrastructure/adapters/MarketplaceAdapterFactory';
import { FetchMarketplaceHttpClient } from '../../infrastructure/adapters/FetchMarketplaceHttpClient';
import { OlxTaxonomyResolver } from '../../infrastructure/adapters/OlxTaxonomyResolver';
import { RedisMarketplaceOAuthStateStore } from '../../infrastructure/cache/RedisMarketplaceOAuthStateStore';
import { RedisMarketplaceOAuthRefreshLock } from '../../infrastructure/cache/RedisMarketplaceOAuthRefreshLock';
import { AesGcmCredentialVault } from '../../infrastructure/security/AesGcmCredentialVault';
import { OlxOAuthClient } from '../../infrastructure/external/OlxOAuthClient';
import { env } from '../env';
import { HermesAI } from '../../infrastructure/external/HermesAI';
import { HermesCompletionClient } from '../../infrastructure/external/HermesCompletionClient';
import { createEmailProvider } from '../../infrastructure/external/EmailProvider';
import { createTelegramBot } from '../../infrastructure/external/TelegramBot';
import { PublishListingHandler } from '../../infrastructure/jobQueue/JobHandlers/PublishListingHandler';
import { SyncMarketplaceHandler } from '../../infrastructure/jobQueue/JobHandlers/SyncMarketplaceHandler';
import {
  HermesRunHandler,
  type HermesEngine,
} from '../../infrastructure/jobQueue/JobHandlers/HermesRunHandler';

// --- Domain: services + ports ---
import { ProductService } from '../../domain/services/ProductService';
import { ListingService } from '../../domain/services/ListingService';
import { InvalidStateError } from '../../domain/shared/DomainError';
import { HermesDecisionEngine } from '../../domain/services/HermesDecisionEngine';
import type { IAIProvider } from '../../domain/ports/IAIProvider';

// --- Application: use cases + services + ports ---
import { CreateProductUseCase } from '../../application/usecases/CreateProductUseCase';
import { UpdateProductUseCase } from '../../application/usecases/UpdateProductUseCase';
import { PublishListingUseCase } from '../../application/usecases/PublishListingUseCase';
import { SyncMarketplaceUseCase } from '../../application/usecases/SyncMarketplaceUseCase';
import { RunHermesUseCase } from '../../application/usecases/RunHermesUseCase';
import { ApproveHermesEventUseCase } from '../../application/usecases/ApproveHermesEventUseCase';
import { DismissHermesEventUseCase } from '../../application/usecases/DismissHermesEventUseCase';
import { ProductApplicationService } from '../../application/services/ProductApplicationService';
import { ProductAIDraftService } from '../../application/services/ProductAIDraftService';
import { ProductRecheckService } from '../../application/services/ProductRecheckService';
import { ListingApplicationService } from '../../application/services/ListingApplicationService';
import { HermesApplicationService } from '../../application/services/HermesApplicationService';
import { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import { MarketplaceOAuthService } from '../../application/services/MarketplaceOAuthService';
import { MarketplaceSyncScheduler } from '../../application/services/MarketplaceSyncScheduler';
import { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import {
  ProductCategorySyncService,
  selectProductCategoryTriggerListings,
} from '../../application/services/ProductCategorySyncService';
import { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';
import { CategoryCorrectionOperationService } from '../../application/services/CategoryCorrectionOperationService';
import type { IdGenerator } from '../../application/ports/IdGenerator';
import type {
  IJobQueue,
  JobEnqueueOptions,
  PublishListingJob,
  SyncMarketplaceJob,
  HermesRunJob,
} from '../../application/ports/IJobQueue';

// --- Presentation ---
import type { AppDeps } from '../../presentation/http/app';
import type { IEventSubscriber } from '../../presentation/websocket/HermesLiveUpdates';
import type { ErrorLogger } from '../../presentation/http/middleware/ErrorHandlingMiddleware';

// A queue the container owns end-to-end: enqueue (the application IJobQueue port),
// handler registration (wiring the concrete JobHandler) and lifecycle (close).
export interface ManagedQueue<T> extends IJobQueue<T> {
  scheduleRepeat(data: T, options: { jobId: string; everyMs: number }): Promise<void>;
  removeRepeat(jobId: string): Promise<void>;
  registerHandler(handler: (data: T) => Promise<unknown>): void;
  close(): Promise<void>;
}

export function buildBullAddOptions(name: string, options?: JobEnqueueOptions) {
  return {
    delay: options?.delayMs,
    jobId: options?.jobId,
    // Publish retries resume from the durable checkpoint and never repeat an
    // ambiguous external POST. Backoff gives transient finalization failures time
    // to recover without hot-looping the queue.
    ...(name === 'publish-listing' || name === 'sync-marketplace'
      ? { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } }
      : {}),
  };
}

// Default managed queue backed by Bull. Maps the application-owned enqueue
// options onto Bull's job options and adapts the processor callback shape.
class BullManagedQueue<T> implements ManagedQueue<T> {
  private readonly queue: BullJobQueue<T>;

  constructor(private readonly name: string) {
    this.queue = new BullJobQueue<T>(name);
  }

  async enqueue(data: T, options?: JobEnqueueOptions): Promise<void> {
    await this.queue.add(data, buildBullAddOptions(this.name, options));
  }

  async scheduleRepeat(data: T, options: { jobId: string; everyMs: number }): Promise<void> {
    await this.queue.add(data, {
      ...buildBullAddOptions(this.name, { jobId: options.jobId }),
      repeat: { every: options.everyMs },
    });
  }

  async removeRepeat(jobId: string): Promise<void> {
    const jobs = await this.queue.raw.getRepeatableJobs();
    await Promise.all(
      jobs
        .filter((job) => job.id === jobId)
        .map((job) => this.queue.raw.removeRepeatableByKey(job.key))
    );
  }

  registerHandler(handler: (data: T) => Promise<unknown>): void {
    this.queue.processAsync((job) => handler(job.data));
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}

export interface ContainerOverrides {
  pool?: Pool;
  redis?: Redis;
  eventBroker?: EventBroker & EventSubscriber;
  aiProvider?: IAIProvider;
  idGenerator?: IdGenerator;
  logger?: ErrorLogger;
  marketplaceCredentialsKey?: string;
  // Factory for background job queues. Overridable so tests avoid a live Bull/Redis.
  createQueue?: <T>(name: string) => ManagedQueue<T>;
}

export interface AppContainer {
  deps: AppDeps;
  // Injected into HermesLiveUpdates so the WS fans domain events out to clients.
  subscriber: IEventSubscriber;
  // Lifecycle handles for graceful shutdown / health checks.
  pool: Pool;
  redis: Redis;
  cache: RedisCache;
  queues: ManagedQueue<unknown>[];
  shutdown(): Promise<void>;
}

// Build the entire object graph and return an AppDeps-compatible container.
export function buildContainer(overrides: ContainerOverrides = {}): AppContainer {
  // 1. Connection-bearing clients.
  const pool = overrides.pool ?? createPool();
  const redis = overrides.redis ?? createRedisClient();

  // 2. Event broker (publish + in-process fan-out) and publisher.
  const broker: EventBroker & EventSubscriber =
    overrides.eventBroker ?? createRedisEventBroker(redis);
  const eventPublisher = createEventPublisher(broker);
  const cache = createRedisCache(redis);

  // 3. Cross-cutting ports.
  const idGenerator: IdGenerator = overrides.idGenerator ?? randomUUID;
  const aiProvider: IAIProvider =
    overrides.aiProvider ?? new HermesAI(new HermesCompletionClient());
  const buildOlxHeaders = (accessToken?: string): Record<string, string> => ({
    Accept: 'application/json',
    Version: '2.0',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  });
  const olxHttpClient =
    env.marketplaces.olx.adapterMode === 'real'
      ? new FetchMarketplaceHttpClient({
          defaultHeaders: buildOlxHeaders(env.marketplaces.olx.accessToken),
          timeoutMs: env.marketplaces.olx.requestTimeoutMs,
          livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
        })
      : undefined;
  const adapterFactory = new MarketplaceAdapterFactory({
    httpClients: olxHttpClient ? { olx: olxHttpClient } : undefined,
    olx: {
      baseUrl: env.marketplaces.olx.apiBaseUrl,
      requirePublishDetails: env.marketplaces.olx.adapterMode === 'real',
      categoryIds: env.marketplaces.olx.categoryIds,
      cityId: env.marketplaces.olx.cityId,
      districtId: env.marketplaces.olx.districtId,
      contactName: env.marketplaces.olx.contactName,
      contactPhone: env.marketplaces.olx.contactPhone,
      advertiserType: env.marketplaces.olx.advertiserType,
      priceNegotiable: env.marketplaces.olx.priceNegotiable,
      conditionAttributeCode: env.marketplaces.olx.conditionAttributeCode,
      deliveryAttributeCode: env.marketplaces.olx.deliveryAttributeCode,
      deliveryOptionCode: env.marketplaces.olx.deliveryOptionCode,
    },
  });
  // Notifiers are constructed (stubbed when unconfigured) so the graph is complete
  // and ready for future notification wiring; no consumer requires them yet.
  createEmailProvider();
  createTelegramBot();

  const createQueue = overrides.createQueue ?? (<T>(name: string) => new BullManagedQueue<T>(name));

  // 4. Repositories. They use the injected pool (or the module-level default if
  //    not overridden). An optional PoolClient can enlist them in an outer transaction.
  const productRepo = new ProductRepository(pool);
  const listingRepo = new ListingRepository(pool);
  const marketplaceRepo = new MarketplaceRepository(pool);
  const marketplaceAccountRepo = new MarketplaceAccountRepository(pool);
  const marketplaceAppCredentialRepo = new MarketplaceAppCredentialRepository(pool);
  const publishAttemptRepo = new PublishAttemptRepository(pool);
  const eventRepo = new EventRepository(pool);
  const workspaceRepo = new WorkspaceRepository(pool);
  const settingsRepo = new SettingsRepository(pool);
  const activityLogRepo = new ActivityLogRepository(pool);
  const authUserStore = new AuthUserRepository(pool);
  const priceHistoryRepo = new PriceHistoryRepository(pool);
  const olxPublicationQuotaRepo = new OlxPublicationQuotaRepository(pool);
  const categoryCorrectionOperationRepo = new CategoryCorrectionOperationRepository(pool);
  const marketplaceOAuthService = new MarketplaceOAuthService({
    marketplaceRepo,
    accountRepo: marketplaceAccountRepo,
    appCredentialRepo: marketplaceAppCredentialRepo,
    stateStore: new RedisMarketplaceOAuthStateStore(redis),
    oauthClientFactory: ({ clientId, clientSecret }) =>
      new OlxOAuthClient({
        authorizationUrl: env.marketplaces.olx.authUrl,
        tokenUrl: env.marketplaces.olx.tokenUrl,
        clientId,
        clientSecret,
        redirectUri: env.marketplaces.olx.redirectUri,
        scopes: env.marketplaces.olx.requiredScopes
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter(Boolean),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
      }),
    credentialVault: new AesGcmCredentialVault(
      overrides.marketplaceCredentialsKey ?? env.marketplaceCredentialsKey
    ),
    refreshLock: new RedisMarketplaceOAuthRefreshLock(redis, overrides.logger),
    idGenerator,
    stateGenerator: () => randomBytes(32).toString('base64url'),
  });
  const olxPublicationQuotaService = new OlxPublicationQuotaService(
    marketplaceRepo,
    marketplaceAccountRepo,
    olxPublicationQuotaRepo,
    activityLogRepo,
    idGenerator,
    {
      resolve: (domainCategory) => {
        const normalized = domainCategory.trim().toLowerCase();
        const categoryId = env.marketplaces.olx.categoryIds[normalized];
        return categoryId === undefined ? null : String(categoryId);
      },
    }
  );

  // 5. Job queues (application IJobQueue ports). Handlers are registered below,
  //    once the services they depend on exist.
  const publishQueue = createQueue<PublishListingJob>('publish-listing');
  const syncQueue = createQueue<SyncMarketplaceJob>('sync-marketplace');
  const hermesQueue = createQueue<HermesRunJob>('hermes-run');
  const marketplaceSyncScheduler = new MarketplaceSyncScheduler(syncQueue);

  // 6. Domain services.
  const productDomainService = new ProductService(productRepo, eventPublisher);
  const listingDomainService = new ListingService(
    listingRepo,
    productRepo,
    marketplaceRepo,
    eventPublisher,
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          listingRepo: new ListingRepository(pool, client),
          productRepo: new ProductRepository(pool, client),
        })
      )
  );
  const hermesEngine = new HermesDecisionEngine(
    productRepo,
    listingRepo,
    eventRepo,
    eventPublisher,
    aiProvider,
    idGenerator
  );

  // 7. Application use cases.
  const createProductUC = new CreateProductUseCase(
    productDomainService,
    workspaceRepo,
    idGenerator
  );
  const updateProductUC = new UpdateProductUseCase(productRepo, eventPublisher, (work) =>
    withPoolTransaction(pool, (client) => work(new ProductRepository(pool, client)))
  );
  const publishListingUC = new PublishListingUseCase(
    listingRepo,
    productRepo,
    marketplaceRepo,
    publishQueue,
    activityLogRepo,
    idGenerator,
    marketplaceAccountRepo,
    olxPublicationQuotaService
  );
  const syncMarketplaceUC = new SyncMarketplaceUseCase(marketplaceRepo, listingRepo, syncQueue);
  const runHermesUC = new RunHermesUseCase(hermesEngine, workspaceRepo);
  const approveEventUC = new ApproveHermesEventUseCase(
    eventRepo,
    productRepo,
    listingRepo,
    marketplaceRepo,
    activityLogRepo,
    priceHistoryRepo,
    publishQueue,
    eventPublisher,
    idGenerator,
    marketplaceAccountRepo,
    olxPublicationQuotaService
  );
  const dismissEventUC = new DismissHermesEventUseCase(
    eventRepo,
    activityLogRepo,
    eventPublisher,
    idGenerator
  );

  // 8. Application services (the facades buildApp consumes).
  const productService = new ProductApplicationService(
    productRepo,
    createProductUC,
    updateProductUC
  );
  const productAIDraftService = new ProductAIDraftService(aiProvider);
  const productRecheckService = new ProductRecheckService(
    productRepo,
    listingRepo,
    marketplaceRepo,
    marketplaceAccountRepo,
    activityLogRepo,
    async (marketplaceId) => {
      const accessToken = await marketplaceOAuthService.getValidAccessToken(marketplaceId);
      const http = new FetchMarketplaceHttpClient({
        defaultHeaders: buildOlxHeaders(accessToken),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
        livePublishEnabled: false,
      });
      return new OlxTaxonomyResolver(http, env.marketplaces.olx.apiBaseUrl);
    },
    idGenerator,
  );
  const listingService = new ListingApplicationService(
    listingRepo,
    publishListingUC,
    syncMarketplaceUC,
    productRepo
  );
  const hermesService = new HermesApplicationService(
    eventRepo,
    runHermesUC,
    approveEventUC,
    dismissEventUC
  );
  const analyticsService = new AnalyticsApplicationService(
    productRepo,
    listingRepo,
    marketplaceRepo,
    new AnalyticsEventRepository(pool),
  );
  const categoryCorrectionOperationService = new CategoryCorrectionOperationService(
    categoryCorrectionOperationRepo,
    eventRepo,
    listingRepo,
    productRepo,
    marketplaceRepo,
    marketplaceAccountRepo,
    olxPublicationQuotaService,
    {
      resolve: async (marketplace, expectedAccount) => {
        if (env.marketplaces.olx.adapterMode !== 'real')
          return adapterFactory.create(marketplace.key);
        const accessToken = await marketplaceOAuthService.getValidAccessToken(
          marketplace.id,
          expectedAccount,
        );
        return adapterFactory.create(
          marketplace.key,
          new FetchMarketplaceHttpClient({
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
          })
        );
      },
    },
    activityLogRepo,
    idGenerator,
    publishAttemptRepo
  );
  const productCategorySyncService = new ProductCategorySyncService(
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
        })
      ),
    idGenerator
  );
  const marketplaceImportService = new MarketplaceImportService(
    marketplaceRepo,
    productRepo,
    listingRepo,
    marketplaceAccountRepo,
    adapterFactory,
    marketplaceOAuthService,
    (accessToken) =>
      new FetchMarketplaceHttpClient({
        defaultHeaders: buildOlxHeaders(accessToken),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
        livePublishEnabled: false,
      }),
    activityLogRepo,
    idGenerator,
    (work) =>
      withPoolTransaction(pool, (client) =>
        work({
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
          correctionOperations: new CategoryCorrectionOperationRepository(pool, client),
          accountRepo: new MarketplaceAccountRepository(pool, client),
        })
      ),
    eventRepo,
    categoryCorrectionOperationRepo,
    productCategorySyncService
  );

  // 9. Register job handlers now that their collaborators exist. The publish
  //    handler is given the domain ListingService so a successful adapter publish
  //    finalizes the listing (status -> live, marketplaceListingId, publishedAt)
  //    and records the canonical `listing.published` event.
  const publishHandler = new PublishListingHandler(
    adapterFactory,
    eventPublisher,
    listingDomainService,
    env.marketplaces.olx.adapterMode === 'real' ? marketplaceOAuthService : undefined,
    env.marketplaces.olx.adapterMode === 'real'
      ? (accessToken) =>
          new FetchMarketplaceHttpClient({
            defaultHeaders: buildOlxHeaders(accessToken),
            timeoutMs: env.marketplaces.olx.requestTimeoutMs,
            livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
          })
      : undefined,
    publishAttemptRepo,
    olxPublicationQuotaService
  );
  publishQueue.registerHandler((data) => publishHandler.handle(data));

  // The sync handler persists fetched listing stats and updates the marketplace
  // lastSyncAt/errorCount via the injected repositories (C5).
  const syncHandler = new SyncMarketplaceHandler(adapterFactory, {
    listingStore: listingRepo,
    marketplaceStore: marketplaceRepo,
    accessTokens: env.marketplaces.olx.adapterMode === 'real' ? marketplaceOAuthService : undefined,
    authenticatedHttpClient:
      env.marketplaces.olx.adapterMode === 'real'
        ? (accessToken) =>
            new FetchMarketplaceHttpClient({
              defaultHeaders: buildOlxHeaders(accessToken),
              timeoutMs: env.marketplaces.olx.requestTimeoutMs,
              livePublishEnabled: env.marketplaces.olx.livePublishEnabled,
            })
        : undefined,
    eventPublisher,
    recommendCategoryMismatch: (input) =>
      marketplaceImportService.recommendSyncedCategoryMismatch(input),
    persistAndReconcileProductCategories: async ({
      marketplace,
      listings,
      expectedUpdatedAt,
      mismatchCandidates,
      marketplaceAccount,
      job,
    }) => {
      await withPoolTransaction(pool, async (client) => {
        const repositories = {
          productRepo: new ProductRepository(pool, client),
          listingRepo: new ListingRepository(pool, client),
          marketplaceRepo: new MarketplaceRepository(pool, client),
          activityLog: new ActivityLogRepository(pool, client),
          eventRepo: new EventRepository(pool, client),
          correctionOperations: new CategoryCorrectionOperationRepository(pool, client),
          accountRepo: new MarketplaceAccountRepository(pool, client),
        };
        const productIds = [...new Set(listings.map((listing) => listing.productId))].sort();
        for (const productId of productIds) {
          const product = await repositories.productRepo.findByIdForWorkspaceForUpdate(
            productId,
            marketplace.workspaceId
          );
          if (!product) throw new Error(`Product not found for synchronized listing: ${productId}`);
        }
        await repositories.listingRepo.saveAllIfUnchanged(listings, expectedUpdatedAt);
        if (mismatchCandidates.length > 0 && !marketplaceAccount) {
          throw new InvalidStateError(
            'Marketplace account binding is required before category reconciliation'
          );
        }
        for (const candidate of mismatchCandidates) {
          await marketplaceImportService.recommendSyncedCategoryMismatch(
            {
              ...candidate,
              workspaceId: marketplace.workspaceId,
              marketplaceAccount: marketplaceAccount!,
            },
            repositories
          );
        }
        for (const listing of selectProductCategoryTriggerListings(listings)) {
          await productCategorySyncService.reconcileWithRepositories(
            {
              workspaceId: marketplace.workspaceId,
              listingId: listing.id,
              trigger: job.trigger ?? 'scheduled',
              actorId: job.actorId,
            },
            repositories
          );
        }
      });
    },
  });
  syncQueue.registerHandler((data) => syncHandler.handle(data));

  // Adapt the Hermes application service to the handler's minimal HermesEngine port.
  const hermesEnginePort: HermesEngine = {
    run: async (data) => {
      const result = await hermesService.runHermes({
        workspaceId: data.workspaceId,
        trigger: data.trigger,
      });
      // Throw on failure so the Bull job records a failure (and retries) instead
      // of reporting eventsGenerated:0 as a success and swallowing the error (C2).
      if (result.isErr()) {
        throw result.error;
      }
      return {
        workspaceId: data.workspaceId,
        eventsGenerated: result.value.length,
      };
    },
  };
  const hermesHandler = new HermesRunHandler(hermesEnginePort, eventPublisher);
  hermesQueue.registerHandler((data) => hermesHandler.handle(data));

  // 10. Assemble AppDeps.
  const deps: AppDeps = {
    productService,
    productAIDraftService,
    productRecheckService,
    listingService,
    hermesService,
    analyticsService,
    productRepo,
    listingRepo,
    marketplaceRepo,
    marketplaceOAuthService,
    marketplaceSyncScheduler,
    marketplaceImportService,
    olxTaxonomyResolver: async (marketplaceId) => {
      const accessToken = await marketplaceOAuthService.getValidAccessToken(marketplaceId);
      const http = new FetchMarketplaceHttpClient({
        defaultHeaders: buildOlxHeaders(accessToken),
        timeoutMs: env.marketplaces.olx.requestTimeoutMs,
        livePublishEnabled: false,
      });
      return new OlxTaxonomyResolver(http, env.marketplaces.olx.apiBaseUrl);
    },
    olxPublicationQuotaService,
    categoryCorrectionOperationService,
    marketplaceOAuthReturnUrl: env.marketplaces.olx.oauthSuccessUrl,
    workspaceRepo,
    settingsRepo,
    authUserStore,
    priceHistoryReader: priceHistoryRepo,
    priceHistoryRecorder: priceHistoryRepo,
    idGenerator,
    logger: overrides.logger,
  };

  const queues: ManagedQueue<unknown>[] = [
    publishQueue as ManagedQueue<unknown>,
    syncQueue as ManagedQueue<unknown>,
    hermesQueue as ManagedQueue<unknown>,
  ];

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled(queues.map((q) => q.close()));
    await Promise.allSettled([
      typeof (redis as { quit?: () => Promise<unknown> }).quit === 'function'
        ? (redis as unknown as { quit: () => Promise<unknown> }).quit()
        : Promise.resolve(),
      typeof (pool as { end?: () => Promise<unknown> }).end === 'function'
        ? (pool as unknown as { end: () => Promise<unknown> }).end()
        : Promise.resolve(),
    ]);
  };

  return {
    deps,
    subscriber: broker,
    pool,
    redis,
    cache,
    queues,
    shutdown,
  };
}
