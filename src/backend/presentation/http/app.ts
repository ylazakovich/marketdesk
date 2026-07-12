// HTTP application factory. buildApp(deps) constructs the controllers from injected
// application services / repositories / ports, wires the /api router with auth,
// validation and rate limiting, and installs the central error handler LAST. Group 6
// fulfils AppDeps from the DI container; tests fulfil it with in-memory doubles.

import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

import type { ProductApplicationService } from '../../application/services/ProductApplicationService';
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

import { isProduction } from '../../config/env';
import { NotFoundError } from '../../domain/shared/DomainError';
import { ProductController } from './controllers/ProductController';
import { ListingController } from './controllers/ListingController';
import { MarketplaceController } from './controllers/MarketplaceController';
import { HermesController } from './controllers/HermesController';
import { AnalyticsController } from './controllers/AnalyticsController';
import { WorkspaceController } from './controllers/WorkspaceController';
import { AuthController } from './controllers/AuthController';
import { createApiRouter } from './routes';
import { createErrorHandler, type ErrorLogger } from './middleware/ErrorHandlingMiddleware';

// Shape Group 6 must fulfil to build the HTTP surface.
export interface AppDeps {
  productService: ProductApplicationService;
  listingService: ListingApplicationService;
  hermesService: HermesApplicationService;
  analyticsService: AnalyticsApplicationService;
  productRepo: IProductRepository;
  listingRepo: IListingRepository;
  marketplaceRepo: IMarketplaceRepository;
  workspaceRepo: IWorkspaceRepository;
  authUserStore: IAuthUserStore;
  // Optional ports (graceful degradation until wired).
  priceHistoryReader?: IPriceHistoryReader;
  priceHistoryRecorder?: IPriceHistoryRecorder;
  idGenerator?: IdGenerator;
  logger?: ErrorLogger;
}

export interface AppOptions {
  enableRateLimit?: boolean;
  corsOrigin?: string;
}

export function buildApp(deps: AppDeps, options: AppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  app.use(compression());
  // CORS fail-closed in production: with credentials:true a wildcard origin would
  // let any site make authenticated cross-origin calls, so production requires an
  // explicit, non-wildcard origin. Dev keeps the permissive default. (S7)
  const corsOrigin = options.corsOrigin ?? '*';
  if (isProduction && (corsOrigin === '*' || !options.corsOrigin)) {
    throw new Error(
      'CORS origin must be an explicit non-wildcard value in production (set CORS_ORIGIN)',
    );
  }
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 3600,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  const controllers = {
    auth: new AuthController(deps.authUserStore, deps.workspaceRepo),
    products: new ProductController(
      deps.productService,
      deps.listingService,
      deps.productRepo,
    ),
    listings: new ListingController(deps.listingService, deps.listingRepo, {
      priceHistoryReader: deps.priceHistoryReader,
      priceHistoryRecorder: deps.priceHistoryRecorder,
      idGenerator: deps.idGenerator,
    }),
    marketplaces: new MarketplaceController(deps.marketplaceRepo, deps.listingService),
    hermes: new HermesController(deps.hermesService),
    analytics: new AnalyticsController(deps.analyticsService),
    workspaces: new WorkspaceController(deps.workspaceRepo),
  };

  app.use(
    '/api',
    createApiRouter(controllers, { enableRateLimit: options.enableRateLimit }),
  );

  // Unmatched /api route -> 404 envelope via the central error handler.
  app.use('/api', (req: Request, _res: Response, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // Central error handler MUST be last.
  app.use(createErrorHandler(deps.logger));

  return app;
}
