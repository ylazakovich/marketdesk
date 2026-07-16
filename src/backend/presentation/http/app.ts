// HTTP application factory. buildApp(deps) constructs the controllers from injected
// application services / repositories / ports, wires the /api router with auth,
// validation and rate limiting, and installs the central error handler LAST. Group 6
// fulfils AppDeps from the DI container; tests fulfil it with in-memory doubles.

import express, { type Express, type Request, type Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import crypto from 'crypto';
import path from 'path';

import type { ProductApplicationService } from '../../application/services/ProductApplicationService';
import { ProductAIDraftService } from '../../application/services/ProductAIDraftService';
import type { ListingApplicationService } from '../../application/services/ListingApplicationService';
import type { HermesApplicationService } from '../../application/services/HermesApplicationService';
import type { AnalyticsApplicationService } from '../../application/services/AnalyticsApplicationService';
import type { IProductRepository } from '../../domain/repositories/interfaces/IProductRepository';
import type { IListingRepository } from '../../domain/repositories/interfaces/IListingRepository';
import type { IMarketplaceRepository } from '../../domain/repositories/interfaces/IMarketplaceRepository';
import type { IWorkspaceRepository } from '../../domain/repositories/interfaces/IWorkspaceRepository';
import type { IPriceHistoryReader } from '../../application/ports/IPriceHistoryReader';
import type { IPriceHistoryRecorder } from '../../application/ports/IPriceHistoryRecorder';
import type { IdGenerator } from '../../application/ports/IdGenerator';
import type { IAuthUserStore } from './ports/IAuthUserStore';
import type { ProductImageUploadService } from '../../application/services/ProductImageUploadService';

import { NotFoundError } from '../../domain/shared/DomainError';
import { env, isProduction } from '../../config/env';
import { ProductImageUploadService as DefaultProductImageUploadService } from '../../application/services/ProductImageUploadService';
import { FilesystemProductImageStorage } from '../../infrastructure/storage/FilesystemProductImageStorage';
import { ProductController } from './controllers/ProductController';
import { ListingController } from './controllers/ListingController';
import { MarketplaceController } from './controllers/MarketplaceController';
import { HermesController } from './controllers/HermesController';
import { AnalyticsController } from './controllers/AnalyticsController';
import { WorkspaceController } from './controllers/WorkspaceController';
import { AuthController } from './controllers/AuthController';
import { ProductImageUploadController } from './controllers/ProductImageUploadController';
import type { MarketplaceOAuthService } from '../../application/services/MarketplaceOAuthService';
import type { MarketplaceSyncScheduler } from '../../application/services/MarketplaceSyncScheduler';
import type { MarketplaceImportService } from '../../application/services/MarketplaceImportService';
import type { OlxPublicationQuotaService } from '../../application/services/OlxPublicationQuotaService';
import { createApiRouter } from './routes';
import { createErrorHandler, type ErrorLogger } from './middleware/ErrorHandlingMiddleware';

// Shape Group 6 must fulfil to build the HTTP surface.
export interface AppDeps {
  productService: ProductApplicationService;
  productAIDraftService?: ProductAIDraftService;
  listingService: ListingApplicationService;
  hermesService: HermesApplicationService;
  analyticsService: AnalyticsApplicationService;
  productRepo: IProductRepository;
  listingRepo: IListingRepository;
  marketplaceRepo: IMarketplaceRepository;
  marketplaceOAuthService: MarketplaceOAuthService;
  marketplaceSyncScheduler: MarketplaceSyncScheduler;
  marketplaceImportService: MarketplaceImportService;
  olxPublicationQuotaService?: OlxPublicationQuotaService;
  marketplaceOAuthReturnUrl: string;
  workspaceRepo: IWorkspaceRepository;
  authUserStore: IAuthUserStore;
  productImageUploadService?: ProductImageUploadService;
  // Optional ports (graceful degradation until wired).
  priceHistoryReader?: IPriceHistoryReader;
  priceHistoryRecorder?: IPriceHistoryRecorder;
  idGenerator?: IdGenerator;
  logger?: ErrorLogger;
}

export interface AppOptions {
  enableRateLimit?: boolean;
  corsOrigin?: string;
  maxUploadFileSize?: number;
}

const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    directives: {
      imgSrc: [
        "'self'",
        'data:',
        'https://*.olxcdn.com',
        'https://*.apollo.olxcdn.com',
        'https://ireland.apollo.olxcdn.com',
      ],
    },
  },
} satisfies Parameters<typeof helmet>[0];

function parseCorsAllowlist(
  originConfig: string | undefined,
  isProductionMode: boolean,
): Set<string> {
  const configured = (originConfig ?? '').trim();

  if (isProductionMode) {
    const configuredOrigins = configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .filter((origin) => origin !== '*');

    if (configuredOrigins.length === 0) {
      throw new Error(
        'CORS_ORIGIN in production must be an explicit, non-wildcard allowlist',
      );
    }

    return new Set(configuredOrigins);
  }

  const origins = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .filter((origin) => origin !== '*');
  return new Set(origins.length > 0 ? origins : [DEFAULT_CORS_ORIGIN]);
}

export function createCorsOptions(originConfig: string | undefined, isProd = isProduction): CorsOptions {
  const allowlist = parseCorsAllowlist(originConfig, isProd);
  return {
    origin: (requestOrigin, callback) => {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      callback(null, allowlist.has(requestOrigin) ? requestOrigin : false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 3600,
    exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  };
}

export function buildApp(deps: AppDeps, options: AppOptions = {}): Express {
  const app = express();
  const maxUploadFileSize = options.maxUploadFileSize ?? env.upload.maxFileSize;
  const productImageUploadService =
    deps.productImageUploadService ??
    new DefaultProductImageUploadService(
      new FilesystemProductImageStorage(
        path.resolve(process.cwd(), env.upload.uploadDir),
        crypto.randomUUID,
        {
          maxWorkspaceBytes: env.upload.maxWorkspaceBytes,
          maxWorkspaceFiles: env.upload.maxWorkspaceFiles,
        },
      ),
      maxUploadFileSize,
    );

  app.use(helmet(HELMET_OPTIONS));
  app.use(compression());
  // CORS is allowlist-based when credentials are enabled. We intentionally avoid
  // reflecting a user-controlled env value directly into `origin`, which CodeQL
  // treats as permissive CORS configuration. Multiple allowed origins can be
  // supplied via comma-separated CORS_ORIGIN values.
  app.use(cors(createCorsOptions(options.corsOrigin)));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  const controllers = {
    auth: new AuthController(deps.authUserStore, deps.workspaceRepo, deps.marketplaceRepo),
    products: new ProductController(
      deps.productService,
      deps.listingService,
      deps.productAIDraftService ?? new ProductAIDraftService(),
      deps.productRepo,
      deps.listingRepo,
      deps.marketplaceRepo,
      deps.idGenerator ?? crypto.randomUUID,
    ),
    listings: new ListingController(deps.listingService, deps.listingRepo, {
      priceHistoryReader: deps.priceHistoryReader,
      priceHistoryRecorder: deps.priceHistoryRecorder,
      idGenerator: deps.idGenerator,
      productRepo: deps.productRepo,
      marketplaceRepo: deps.marketplaceRepo,
      olxQuotaService: deps.olxPublicationQuotaService,
    }),
    marketplaces: new MarketplaceController(
      deps.marketplaceRepo,
      deps.listingService,
      deps.marketplaceOAuthService,
      deps.marketplaceSyncScheduler,
      deps.marketplaceImportService,
      deps.olxPublicationQuotaService,
      deps.marketplaceOAuthReturnUrl,
      deps.logger,
    ),
    hermes: new HermesController(deps.hermesService),
    analytics: new AnalyticsController(deps.analyticsService),
    workspaces: new WorkspaceController(deps.workspaceRepo),
    uploads: new ProductImageUploadController(productImageUploadService),
  };

  app.use(
    '/api',
    createApiRouter(controllers, {
      enableRateLimit: options.enableRateLimit,
      maxUploadFileSize,
    }),
  );

  // Unmatched /api route -> 404 envelope via the central error handler.
  app.use('/api', (req: Request, _res: Response, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // Central error handler MUST be last.
  app.use(createErrorHandler(deps.logger));

  return app;
}
