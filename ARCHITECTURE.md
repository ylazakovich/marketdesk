# MarketDesk: Software Architecture Document (SAD)

**Version**: 1.0  
**Status**: Final  
**Tech Stack**: TypeScript/Node.js, React, PostgreSQL, Redis  
**Deployment**: Self-hosted (Hetzner VPS)  
**Last Updated**: July 2026

---

## Executive Summary

MarketDesk is a multi-marketplace SaaS control panel enabling sellers to manage products and listings across 7+ marketplaces (OLX, Allegro, Vinted, Facebook Marketplace, eBay, Etsy, Amazon) from a single unified dashboard. The system is powered by Hermes, an autonomous AI agent that suggests and executes optimizations with human-in-the-loop approval gates.

**Architectural Vision**: Clean architecture principles with marketplace-agnostic abstraction. The system is designed as a collection of independent, loosely-coupled domains (Products, Listings, Marketplaces, Analytics, AI) communicating via events. This enables:
- **Extensibility**: New marketplaces add via adapter pattern, not core logic changes
- **Scalability**: Event-driven async processing on self-hosted infrastructure
- **Auditability**: Immutable event log for compliance and debugging
- **Autonomy Tiers**: Hermes operates under user-configured governance (suggest-only → balanced → full-auto)

**Key Constraints**: Self-hosted on VPS (no serverless), marketplace abstraction is mandatory, production-grade security & compliance, 40-50 concurrent users at launch scaling to 1000+ users.

---

## 1. Overall Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│         React SPA + MUI Material Components                 │
│    (Dashboard, Products, Listings, Analytics, Hermes)       │
└──────────────────┬──────────────────────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────────────────────┐
│                Application Layer                             │
│  Use Cases: CreateProduct, PublishListing, ApproveHermes    │
│  Services: ProductService, ListingService, HermesService    │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                  Domain Layer                                │
│  Entities: Product, Listing, Marketplace, HermesEvent       │
│  Aggregates & Business Rules (invariants, validations)      │
│  Repository Interfaces (abstraction, no impl details)       │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│             Infrastructure Layer                             │
│  Repositories (PostgreSQL), Adapters (Marketplace APIs),     │
│  Event Broker (Redis Streams), Job Queue (Bull),            │
│  Cache (Redis), Email/SMS providers                         │
└─────────────────────────────────────────────────────────────┘
```

**Why This Architecture?**
- **Domain layer independence**: Business rules live in domain; easy to test, reuse, maintain
- **Clear separation of concerns**: Each layer has one reason to change
- **Async-first design**: Events decouple components; scaling becomes distributed work
- **Testability**: Mock repositories & services; unit tests don't touch DB or APIs
- **Marketplace abstraction**: Domain knows nothing of OLX/eBay/Etsy specifics

---

## 2. High-Level Component Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                            │
│  Dashboard | Products | Listings | Analytics | Hermes | Settings  │
└─────────────────────┬──────────────────────────────────────────────┘
                      │ REST API (JSON)
┌─────────────────────▼──────────────────────────────────────────────┐
│                    Backend API (Node.js/Express)                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Authentication (JWT + Refresh Tokens)                      │  │
│  │  Route handlers → Controllers → Services → Repositories     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────┬──────────────────┬──────────────────┬────────────────────┘
          │                  │                  │
    ┌─────▼──────┐    ┌──────▼────────┐  ┌────▼──────────────┐
    │ PostgreSQL │    │ Redis Broker  │  │ Marketplace APIs  │
    │ (Products, │    │ (Event Stream)│  │ (OLX, Allegro,    │
    │  Listings, │    │               │  │  Vinted, eBay...)  │
    │  Events,   │    │ Redis Cache   │  └────────────────────┘
    │  Analytics)│    │               │  ┌─────────────────────────┐
    └────────────┘    │ Bull Jobs     │  │ Hermes Agent API       │
                      │ (Background   │  │ (native agent runtime)  │
                      │  sync, pub)   │  └─────────────────────────┘
                      └───────────────┘
```

**Component Responsibilities**:
- **Frontend**: User interactions, real-time UI updates, state management
- **API Gateway**: Auth, request validation, rate limiting
- **Domain Services**: Business logic, validations, event emission
- **Repositories**: Data access (PostgreSQL), marketplace credential vaults
- **Event Broker**: Decouples services, enables async workflows
- **Background Jobs**: Marketplace sync, Hermes runs, analytics aggregation
- **External APIs**: Marketplace adapters (pluggable); local Hermes Agent API Server for AI/agent work

---

## 3. Domain Model

### Core Entities & Aggregates

```
Workspace (Root Aggregate)
  ├── id, name, timezone, currency
  ├── has many Products
  ├── has many Marketplaces
  ├── has many HermesEvents
  └── Preferences (autonomyLevel, notificationSettings, etc.)

Product (Aggregate Root)
  ├── id, sku, name, description
  ├── cost, price, condition, category
  ├── status (draft | active | attention | sold)
  ├── tags[], images[]
  ├── has many Listings (one per marketplace)
  ├── has many HermesEvents
  └── has many PriceHistoryPoints

Listing (Child of Product)
  ├── id, productId, marketplaceId
  ├── marketplaceListingId (external ID)
  ├── price, status (live | draft | expired | error)
  ├── views, watchers, messages
  ├── expiresAt, publishedAt
  └── sync metadata (lastSyncAt, syncError)

Marketplace (Aggregate Root)
  ├── id, key (olx|allegro|vinted|...)
  ├── connected, status (syncing | live | error)
  ├── syncMode (realtime | hourly | manual)
  ├── lastSyncAt, errorCount
  └── has one MarketplaceAccount (credentials)

HermesEvent (Event Log Entry)
  ├── id, type (suggest_price | create_listing | relist | ...)
  ├── severity (info | success | warning | critical)
  ├── status (pending | approved | dismissed | applied)
  ├── productId, proposedChange (typed payload)
  ├── title, detail, timestamp
  └── autonomyDecision (auto_applied | pending_review)

PriceHistory
  ├── listingId, price, changedBy (user | hermes)
  ├── reason (manual_edit | competitor_alert | hermes_suggestion)
  └── at (timestamp)

ActivityLog (Audit Trail)
  ├── entityRef (product:123 | listing:456)
  ├── actor (user:x | hermes), action, metadata
  └── at (timestamp)
```

### Key Invariants

```typescript
// Product invariants
- sellingPrice >= 0; selling below cost is allowed as an intentional seller decision and surfaced as a warning
- description.length >= 20 && <= 2000
- status transitions: draft → active → attention → sold (not reverse)

// Listing invariants
- Listing.price must be set before publish
- Listing.status = live only if Product.status != sold
- Marketplace must be connected to publish

// HermesEvent invariants
- proposedChange must be fully typed (e.g., {field: 'price', from: 100, to: 90})
- Can only approve if status = pending & autonomyLevel permits
- Critical events (price > 20% drop) must await human review

// Analytics invariants
- Only count sales from live listings
- Revenue = sum(Listing.price × quantity_sold)
- Profit = Revenue - Cost
```

---

## 4. Module Boundaries

### Backend Directory Structure

```
src/backend/
├── domain/                          # Core business logic (no DB, no HTTP)
│   ├── entities/
│   │   ├── Product.ts
│   │   ├── Listing.ts
│   │   ├── Marketplace.ts
│   │   ├── HermesEvent.ts
│   │   └── Workspace.ts
│   ├── services/                    # Domain services (orchestrate entities)
│   │   ├── ProductService.ts
│   │   ├── ListingService.ts
│   │   ├── HermesDecisionEngine.ts
│   │   └── MarketplaceAdapter.ts (interface)
│   ├── repositories/                # Abstraction, no implementation
│   │   └── interfaces/
│   │       ├── IProductRepository.ts
│   │       ├── IListingRepository.ts
│   │       ├── IMarketplaceRepository.ts
│   │       └── IEventRepository.ts
│   └── valueObjects/
│       ├── Money.ts (PLN handling)
│       └── ListingStatus.ts
│
├── application/                     # Use cases, DTOs, workflows
│   ├── usecases/
│   │   ├── CreateProductUseCase.ts
│   │   ├── PublishListingUseCase.ts
│   │   ├── ApproveHermesEventUseCase.ts
│   │   └── SyncMarketplaceUseCase.ts
│   ├── services/
│   │   ├── ProductApplicationService.ts
│   │   ├── ListingApplicationService.ts
│   │   └── HermesApplicationService.ts
│   ├── dto/
│   │   ├── CreateProductDTO.ts
│   │   ├── PublishListingDTO.ts
│   │   └── ApproveEventDTO.ts
│   └── validators/
│       ├── ProductValidator.ts
│       └── PricingValidator.ts
│
├── infrastructure/                  # Implementations of abstractions
│   ├── persistence/
│   │   ├── repositories/
│   │   │   ├── ProductRepository.ts (PostgreSQL impl)
│   │   │   ├── ListingRepository.ts
│   │   │   ├── EventRepository.ts
│   │   │   └── ActivityLogRepository.ts
│   │   ├── migrations/              # SQL migration files
│   │   └── seeds/
│   ├── adapters/                    # Marketplace-specific implementations
│   │   ├── MarketplaceAdapterFactory.ts
│   │   ├── OLXAdapter.ts
│   │   ├── AllegroAdapter.ts
│   │   ├── VintedAdapter.ts
│   │   ├── FacebookAdapter.ts
│   │   ├── EbayAdapter.ts (stub)
│   │   └── BaseMarketplaceAdapter.ts (abstract)
│   ├── external/
│   │   ├── HermesAI.ts
│   │   ├── HermesCompletionClient.ts
│   │   ├── EmailProvider.ts
│   │   └── TelegramBot.ts
│   ├── eventBroker/
│   │   ├── RedisEventBroker.ts
│   │   └── EventPublisher.ts
│   ├── jobQueue/
│   │   ├── BullJobQueue.ts
│   │   └── JobHandlers/
│   │       ├── SyncMarketplaceHandler.ts
│   │       ├── PublishListingHandler.ts
│   │       └── HermesRunHandler.ts
│   └── cache/
│       └── RedisCache.ts
│
├── presentation/                    # HTTP controllers, middleware
│   ├── http/
│   │   ├── controllers/
│   │   │   ├── ProductController.ts
│   │   │   ├── ListingController.ts
│   │   │   ├── MarketplaceController.ts
│   │   │   ├── HermesController.ts
│   │   │   └── AnalyticsController.ts
│   │   ├── middleware/
│   │   │   ├── AuthMiddleware.ts
│   │   │   ├── ValidationMiddleware.ts
│   │   │   └── ErrorHandlingMiddleware.ts
│   │   ├── routes/
│   │   │   ├── products.ts
│   │   │   ├── listings.ts
│   │   │   ├── marketplaces.ts
│   │   │   ├── hermes.ts
│   │   │   └── analytics.ts
│   │   └── formatters/
│   │       ├── ProductFormatter.ts
│   │       └── ResponseFormatter.ts
│   └── websocket/
│       ├── handlers/ (real-time events)
│       └── HermesLiveUpdates.ts
│
├── shared/
│   ├── types/                       # TypeScript types (domain-agnostic)
│   │   ├── Money.ts
│   │   ├── Marketplace.ts
│   │   └── EventTypes.ts
│   ├── constants/
│   │   └── MarketplaceKeys.ts
│   └── utils/
│       ├── uuid.ts
│       └── dateFormatting.ts
│
└── config/
    ├── database.ts
    ├── redis.ts
    ├── env.ts
    └── di/ (Dependency Injection container)
```

**Module Rules**:
- Domain layer ↔ Application layer ↔ Presentation layer (one-way dependency)
- Domain cannot import from infrastructure or presentation
- Application can import domain but not presentation
- Presentation can import any layer (for dependency injection)
- Infrastructure implements domain interfaces only

---

## 5. Backend Architecture

### Request Handling Pipeline

```
HTTP Request
     │
     ▼
┌──────────────────────────┐
│  Auth Middleware         │  Verify JWT, extract user context
│  (validateToken)         │  
└────────────┬─────────────┘
             │
     ┌───────▼────────┐
     │ Route Handler  │  Express route matching
     └───────┬────────┘
             │
     ┌───────▼──────────────────┐
     │ Request Validator        │  Schema validation (Zod/Joi)
     │ (validateCreateProduct)  │  DTO transformation
     └───────┬──────────────────┘
             │
     ┌───────▼──────────────────┐
     │ Controller               │  Orchestrate use case
     │ (ProductController)      │  Handle errors, format response
     └───────┬──────────────────┘
             │
     ┌───────▼──────────────────┐
     │ Application Service      │  Business workflow
     │ (ProductAppService)      │  Call domain services
     └───────┬──────────────────┘
             │
     ┌───────▼──────────────────┐
     │ Domain Service           │  Core logic, emit events
     │ (ProductService)         │  Enforce invariants
     └───────┬──────────────────┘
             │
     ┌───────▼──────────────────┐
     │ Repository               │  Persist, retrieve data
     │ (ProductRepository)      │  No business logic
     └───────┬──────────────────┘
             │
     ┌───────▼──────────────────┐
     │ Database (PostgreSQL)    │
     └──────────────────────────┘

HTTP Response ◄───── (formatted at each layer)
```

### Key Patterns

**Dependency Injection**:
```typescript
// Container setup in config/di.ts
const container = createContainer();
container.register('productRepository', () => new ProductRepository(db));
container.register('productService', () => new ProductService(
  container.resolve('productRepository'),
  container.resolve('eventPublisher')
));
```

**Service Layer Structure**:
```typescript
// Domain Service (ProductService)
class ProductService {
  create(command: CreateProductCommand): Result<Product> {
    // Validate business rules
    if (!isValidCategory(command.category)) return Err(...);
    
    // Create entity
    const product = Product.create({...});
    
    // Emit domain event
    this.eventPublisher.publish(new ProductCreatedEvent(product.id));
    
    return Ok(product);
  }
}

// Application Service (ProductApplicationService)
class ProductApplicationService {
  async createProduct(dto: CreateProductDTO): Promise<Result<Product>> {
    // 1. Fetch context
    const workspace = await this.workspaceRepo.getById(dto.workspaceId);
    
    // 2. Call domain service
    const result = this.productService.create({
      ...dto,
      workspaceId: workspace.id
    });
    
    // 3. Persist
    if (result.isOk()) {
      await this.productRepo.save(result.value);
    }
    
    // 4. Return result
    return result;
  }
}
```

### Error Handling

```typescript
// Result type (Railway-oriented programming)
type Result<T> = Ok<T> | Err<Error>;

// Domain validation returns Result
const priceResult = validatePrice(product.cost, product.price);
if (priceResult.isErr()) {
  return Err(new ValidationError('Price below cost'));
}

// Controllers translate to HTTP responses
app.post('/products', async (req, res) => {
  const result = await productService.create(req.body);
  
  if (result.isOk()) {
    res.json({ success: true, data: result.value });
  } else {
    const error = result.error;
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});
```

---

## 6. Frontend Architecture

### React Application Structure

```
src/frontend/
├── pages/                           # Route pages (not Next.js, plain React Router)
│   ├── DashboardPage.tsx
│   ├── ProductsPage.tsx
│   ├── ListingDetailsPage.tsx
│   ├── HermesActivityPage.tsx
│   ├── AnalyticsPage.tsx
│   ├── MarketplacesPage.tsx
│   └── SettingsPage.tsx
│
├── components/                      # Reusable UI components
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   └── AppShell.tsx
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Toast.tsx
│   │   └── Skeleton.tsx
│   ├── tables/
│   │   ├── ProductsTable.tsx
│   │   ├── ListingsTable.tsx
│   │   └── AnalyticsTable.tsx
│   ├── charts/
│   │   ├── RevenueChart.tsx
│   │   ├── ViewsChart.tsx
│   │   └── ConversionChart.tsx
│   ├── forms/
│   │   ├── ProductForm.tsx
│   │   ├── PricingForm.tsx
│   │   └── ProductWizardForm.tsx
│   └── hermes/
│       ├── HermesEventCard.tsx
│       └── ApprovalButtons.tsx
│
├── services/                        # API client layer
│   ├── api.ts                       # Axios/fetch configuration
│   ├── endpoints/
│   │   ├── products.ts
│   │   ├── listings.ts
│   │   ├── marketplaces.ts
│   │   ├── hermes.ts
│   │   └── analytics.ts
│   └── hooks/                       # RTK Query hooks
│       ├── useProducts.ts
│       ├── useListings.ts
│       └── useHermesEvents.ts
│
├── state/                           # Redux + RTK Query
│   ├── store.ts
│   ├── slices/
│   │   ├── authSlice.ts
│   │   ├── workspaceSlice.ts
│   │   └── uiSlice.ts (theme, layout state)
│   └── api/                         # RTK Query API slices
│       ├── productsApi.ts
│       ├── listingsApi.ts
│       ├── marketplacesApi.ts
│       └── analyticsApi.ts
│
├── hooks/                           # Custom React hooks
│   ├── useAuth.ts
│   ├── useWorkspace.ts
│   ├── useNotifications.ts
│   └── useDebounce.ts
│
├── utils/
│   ├── formatters.ts               # Currency, date formatting
│   ├── validators.ts               # Client-side validation
│   └── constants.ts
│
├── types/
│   └── index.ts                    # TypeScript types shared with backend
│
├── theme/
│   ├── lightTheme.ts               # MUI theme definition
│   ├── darkTheme.ts
│   └── ThemeProvider.tsx
│
└── App.tsx                          # Root component
```

### State Management Pattern (RTK Query)

```typescript
// Define API slice
const productsApi = createApi({
  reducerPath: 'productsApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getProducts: builder.query<Product[], GetProductsParams>({
      query: (params) => `/products?${qs.stringify(params)}`,
      // Cache, background refetch, normalization all automatic
    }),
    createProduct: builder.mutation<Product, CreateProductDTO>({
      query: (body) => ({
        url: '/products',
        method: 'POST',
        body,
      }),
      // Automatic cache invalidation
      invalidatesTags: [{ type: 'Product', id: 'LIST' }],
    }),
  }),
});

// Use in component
function ProductsPage() {
  const { data: products, isLoading, error } = productsApi.useGetProductsQuery({
    limit: 25,
    offset: 0,
  });
  
  const [createProduct] = productsApi.useCreateProductMutation();
  
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorRetry />;
  
  return <ProductsTable products={products} />;
}
```

### Real-Time Updates

```typescript
// WebSocket hook for Hermes live updates
function useHermesLive() {
  const dispatch = useDispatch();
  
  useEffect(() => {
    const ws = new WebSocket('ws://api/hermes/live');
    
    ws.onmessage = (messageEvent) => {
      const event = JSON.parse(messageEvent.data);
      // Update RTK Query cache or Redux state
      dispatch(hermesApi.util.updateQueryData(
        'getHermesEvents',
        undefined,
        (draft) => {
          draft.unshift(event);
        }
      ));
    };
    
    return () => ws.close();
  }, [dispatch]);
}
```

---

## 7. Database Schema and Evolution

### Canonical executable sources

The canonical PostgreSQL definitions are executable repository files, not duplicated pseudo-DDL in this document:

- `src/backend/persistence/schema.sql` — complete bootstrap schema for a new database;
- `src/backend/persistence/migrations/*.sql` — ordered, forward-only changes for existing databases;
- `src/backend/persistence/migrate.ts` — lexical migration runner.

All DDL uses PostgreSQL syntax. Indexes are separate `CREATE INDEX` statements, marketplace credentials are application-encrypted into an authenticated envelope before that envelope is persisted as JSONB, workspace guardrails are JSONB, and analytics sale events snapshot `cost_at_sale`. Repository mappers and integration tests are part of the schema contract.

### Implemented migration strategy

MarketDesk uses ordered, idempotent SQL migrations. Ordinary files execute through PostgreSQL in lexical order. A migration containing `CREATE INDEX CONCURRENTLY` executes outside a transaction while holding a PostgreSQL advisory lock, because concurrent index DDL cannot run inside a transaction.

The current runner deliberately has no migration ledger and no automatic down migration. Therefore deployment uses a forward-recovery discipline:

1. create and verify a fresh live backup before schema mutation;
2. execute the ordered migrations;
3. verify schema-dependent application flows and health endpoints;
4. recover forward from the verified backup if required.

`node-pg-migrate`, Agenda/MongoDB and other uninstalled libraries are not part of the implemented architecture. Adopting a migration ledger or reversible framework requires a separate approved migration plan. See `ARCHITECTURE_AMENDMENTS.md` fix 2 for the historical decision.

## 8. Repository Structure

```
hermes-marketdesk/
├── src/
│   ├── backend/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   ├── presentation/
│   │   ├── shared/
│   │   ├── config/
│   │   └── index.ts (main entry)
│   ├── frontend/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── services/
│   │   ├── state/
│   │   ├── hooks/
│   │   ├── theme/
│   │   ├── types/
│   │   ├── App.tsx
│   │   └── index.tsx (React DOM render)
│   └── shared/
│       ├── types/
│       └── constants/
│
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.backend
│   │   ├── Dockerfile.frontend
│   │   └── docker-compose.yml
│   ├── nginx/
│   │   └── nginx.conf
│   ├── kubernetes/ (future)
│   └── terraform/ (VPS provisioning)
│
├── tests/
│   ├── unit/
│   │   ├── domain/ (entity & service tests)
│   │   └── utils/
│   ├── integration/
│   │   ├── repositories/
│   │   ├── adapters/
│   │   └── api/
│   └── e2e/
│       └── flows/ (user journey tests)
│
├── docs/
│   ├── ARCHITECTURE.md (this file)
│   ├── API.md (OpenAPI spec)
│   ├── DATABASE.md (schema details)
│   ├── DEPLOYMENT.md (VPS setup)
│   └── MARKETPLACE_INTEGRATION.md
│
├── .github/
│   └── workflows/
│       ├── test.yml (run tests on PR)
│       ├── lint.yml (code quality)
│       └── deploy.yml (push to Hetzner)
│
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 9. Marketplace Adapter Architecture

### Adapter Pattern (Strategy)

Each marketplace (OLX, Allegro, Vinted, eBay, etc.) is wrapped in an adapter implementing a common interface. This keeps the domain layer completely agnostic to marketplace specifics.

```typescript
// Domain Interface (infrastructure/adapters/MarketplaceAdapter.ts)
export interface IMarketplaceAdapter {
  // Configuration
  getKey(): string; // 'olx', 'allegro', etc.
  
  // Authentication
  authenticate(credentials: unknown): Promise<{ accessToken: string }>;
  refreshCredentials(tokens: Tokens): Promise<Tokens>;
  
  // Publish
  publishListing(listing: ListingPublishDTO): Promise<{
    externalListingId: string;
    publishedAt: Date;
  }>;
  
  // Sync (fetch data from marketplace)
  syncListings(externalListingIds: string[]): Promise<SyncedListing[]>;
  syncStats(externalListingIds: string[]): Promise<MarketplaceStats[]>;
  
  // Update
  updatePrice(externalListingId: string, newPrice: number): Promise<void>;
  updateDescription(externalListingId: string, description: string): Promise<void>;
  relist(externalListingId: string): Promise<{ externalListingId: string }>;
  
  // Delete
  unpublish(externalListingId: string): Promise<void>;
  
  // Error handling
  translateError(error: unknown): MarketplaceError;
}
```

### Implementation Example: OLX Adapter

```typescript
// infrastructure/adapters/OLXAdapter.ts
export class OLXAdapter implements IMarketplaceAdapter {
  private client: AxiosInstance;
  private credentials: OLXCredentials;
  
  constructor(credentials: OLXCredentials) {
    this.credentials = credentials;
    this.client = axios.create({
      baseURL: 'https://api.olx.pl/v1',
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
  }
  
  async publishListing(listing: ListingPublishDTO): Promise<{
    externalListingId: string;
    publishedAt: Date;
  }> {
    try {
      const response = await this.client.post('/user/ads', {
        title: listing.product.name,
        description: listing.product.description,
        price: listing.price,
        category_id: this.mapCategory(listing.product.category),
        images: listing.product.images.map(img => img.url),
        params: {
          condition: this.mapCondition(listing.product.condition),
        },
      });
      
      return {
        externalListingId: response.data.id,
        publishedAt: new Date(),
      };
    } catch (error) {
      throw this.translateError(error);
    }
  }
  
  async syncListings(externalListingIds: string[]): Promise<SyncedListing[]> {
    const results = await Promise.all(
      externalListingIds.map(id => this.client.get(`/user/ads/${id}`))
    );
    
    return results.map(res => ({
      externalListingId: res.data.id,
      status: this.mapStatus(res.data.status),
      views: res.data.metrics.views,
      watchers: res.data.metrics.favorites,
      messages: res.data.metrics.messages,
    }));
  }
  
  private mapCategory(domainCategory: string): string {
    const mapping = {
      'electronics': 2000,
      'clothing': 3000,
      // ...
    };
    return mapping[domainCategory] || 'unknown';
  }
  
  translateError(error: unknown): MarketplaceError {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        return new AuthenticationError('OLX: Invalid credentials');
      } else if (error.response?.status === 404) {
        return new NotFoundError('OLX: Listing not found');
      } else if (error.response?.status === 429) {
        return new RateLimitError('OLX: Rate limit exceeded');
      }
    }
    return new UnknownError('OLX: Unknown error');
  }
}
```

### Adapter Factory & Plugin System

```typescript
// infrastructure/adapters/MarketplaceAdapterFactory.ts
export class MarketplaceAdapterFactory {
  private adapters: Map<string, new (...args: any[]) => IMarketplaceAdapter> = new Map();
  
  constructor() {
    this.register('olx', OLXAdapter);
    this.register('allegro', AllegroAdapter);
    this.register('vinted', VintedAdapter);
    this.register('facebook', FacebookAdapter);
    // eBay, Etsy, Amazon registered but not yet implemented
  }
  
  register(key: string, adapterClass: new (...args: any[]) => IMarketplaceAdapter) {
    this.adapters.set(key, adapterClass);
  }
  
  create(marketplaceKey: string, credentials: unknown): IMarketplaceAdapter {
    const AdapterClass = this.adapters.get(marketplaceKey);
    if (!AdapterClass) {
      throw new Error(`Adapter for ${marketplaceKey} not implemented`);
    }
    return new AdapterClass(credentials);
  }
}
```

### Credential Management (Vault)

```typescript
// infrastructure/CredentialVault.ts
export class CredentialVault {
  constructor(private encryption: EncryptionService) {}
  
  async storeCredentials(
    marketplaceId: UUID,
    credentialsObj: unknown
  ): Promise<void> {
    // Encrypt before storing
    const encrypted = this.encryption.encrypt(JSON.stringify(credentialsObj));
    
    // Save to DB
    await db.query(
      'INSERT INTO marketplace_accounts (marketplace_id, credentials) VALUES ($1, $2)',
      [marketplaceId, encrypted]
    );
  }
  
  async retrieveCredentials(marketplaceId: UUID): Promise<unknown> {
    const row = await db.query(
      'SELECT credentials FROM marketplace_accounts WHERE marketplace_id = $1',
      [marketplaceId]
    );
    
    if (!row) throw new NotFoundError('Credentials not found');
    
    // Decrypt on retrieval
    return JSON.parse(this.encryption.decrypt(row.credentials));
  }
}
```

### Sync Orchestration

```typescript
// domain/services/MarketplaceSync.ts
export class MarketplaceSyncService {
  async syncMarketplace(marketplace: Marketplace): Promise<SyncResult> {
    // 1. Get adapter
    const credentials = await this.credentialVault.retrieve(marketplace.id);
    const adapter = this.adapterFactory.create(marketplace.key, credentials);
    
    // 2. Get listings to sync
    const listings = await this.listingRepo.findByMarketplace(marketplace.id);
    const externalIds = listings.map(l => l.externalListingId);
    
    // 3. Sync stats from marketplace
    const syncedStats = await adapter.syncListings(externalIds);
    
    // 4. Update local listings
    for (const stat of syncedStats) {
      const listing = listings.find(l => l.externalListingId === stat.externalListingId);
      if (listing) {
        listing.views = stat.views;
        listing.watchers = stat.watchers;
        listing.status = stat.status;
        await this.listingRepo.save(listing);
      }
    }
    
    // 5. Emit events
    this.eventPublisher.publish(new MarketplaceSyncedEvent(marketplace.id));
    
    return { synced: syncedStats.length, errors: [] };
  }
}
```

---

## 10. Hermes AI Architecture

> **Canonical persisted/API lifecycle:** `pending_decision`, `pending_review`, `applying`, `applied`, `dismissed`, `failed`, `reverting`, `reverted`. Product-facing labels are presentation mappings and never additional persisted states.

| From | Action | To | Invalid use |
| --- | --- | --- | --- |
| `pending_decision` | begin automatic execution | `applying` | any terminal or already-running state |
| `pending_decision` | guardrail requires a person | `pending_review` | any state except `pending_decision` |
| `pending_decision` / `pending_review` | dismiss | `dismissed` | applying or terminal states |
| `pending_review` | approve | `applying` | any state except `pending_review` |
| `applying` | side effect succeeds | `applied` | any state except `applying` |
| `applying` | side effect fails | `failed` | any state except `applying` |
| `applied` | begin undo | `reverting` | any state except `applied` |
| `reverting` | undo succeeds | `reverted` | any state except `reverting` |

`resolved_at` is null for pending/running states and set for terminal states. Approval persists `applying` before executing side effects; a failed application is persisted as `failed`. Undo requires a dedicated executor to perform the inverse operation before `markReverted`; the lifecycle representation does not claim that every event is currently undoable.

### Agent State Machine

```text
pending_decision ──guardrail/unsupported──▶ pending_review ──dismiss──▶ dismissed
        │                                        │
        │ automatic execution                    │ approve
        └────────▶ applying ◀────────────────────┘
                         │
                  persist before effect
                         │
                   ┌─────┴─────┐
                   ▼           ▼
                applied      failed
                   │
                begin undo
                   ▼
                reverting ──undo succeeds──▶ reverted
```

Both `applying` and `reverting` are persisted before their side effects. Forward execution may complete only through `markApplied`; undo may complete only through `markReverted`.

### Decision Engine

```typescript
// Simplified orchestration; the implementation also applies workspace guardrails.
export class HermesDecisionEngine {
  async executeAutomatically(event: HermesEvent, product: Product): Promise<void> {
    if (!this.supportsAutomaticChange(event.proposedChange)) {
      event.requestReview();
      await this.eventRepo.save(event);
      return;
    }

    event.beginAutoApply();
    await this.eventRepo.save(event); // durable checkpoint before the side effect

    try {
      const result = await this.applyChange(product, event.proposedChange);
      if (result.isErr()) {
        event.markFailed();
      } else {
        event.markApplied();
      }
    } catch {
      event.markFailed();
    }

    await this.eventRepo.save(event); // persist the terminal outcome immediately
  }

  async undo(event: HermesEvent): Promise<void> {
    event.beginRevert();
    await this.eventRepo.save(event); // persist `reverting` before undo

    await this.executeInverseChange(event);
    event.markReverted();
    await this.eventRepo.save(event);
  }

  private determineAutonomy(
    autonomyLevel: string,
    eventType: string,
    severity: string,
  ): 'auto_apply' | 'pending_review' {
    if (autonomyLevel === 'suggest_only') return 'pending_review';
    if (severity === 'critical' && eventType === 'competitor_price_detected') {
      return 'pending_review';
    }
    return autonomyLevel === 'full_auto' ? 'auto_apply' : 'pending_review';
  }

  private async checkConditions(product: Product): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    
    // Check 1: Expired listings
    const expiredListings = product.listings.filter(l => l.isExpired());
    if (expiredListings.length > 0) {
      suggestions.push({
        type: 'needs_relisting',
        severity: 'warning',
        title: 'Listing expired',
        detail: `${expiredListings.length} listing(s) have expired`,
        change: { action: 'relist', listingIds: expiredListings.map(l => l.id) },
      });
    }
    
    // Check 2: Competitor undercut
    const undercut = await this.checkCompetitorPrices(product);
    if (undercut) {
      suggestions.push({
        type: 'competitor_price_detected',
        severity: 'critical',
        title: 'Competitor undercut detected',
        detail: `Competitor at ${undercut.competitorPrice}, suggest ${undercut.suggestedPrice}`,
        change: { field: 'price', from: product.price, to: undercut.suggestedPrice },
      });
    }
    
    // Check 3: Missing photos
    if (product.images.length < 3) {
      suggestions.push({
        type: 'suggested_more_photos',
        severity: 'info',
        title: 'Add more photos for better conversion',
        detail: 'Products with 3+ photos sell 40% faster',
        change: null,
      });
    }
    
    // Check 4: SEO opportunity
    const seoScore = await this.analyzeSEO(product);
    if (seoScore < 0.7) {
      suggestions.push({
        type: 'suggested_better_title',
        severity: 'info',
        title: 'Optimize title for searchability',
        detail: `Current title score: ${Math.round(seoScore * 100)}%`,
        change: { field: 'title', from: product.name, to: this.suggestBetterTitle(product) },
      });
    }
    
    return suggestions;
  }
}
```

### Hermes Agent API Integration

```typescript
// infrastructure/external/HermesAI.ts
export class HermesAI implements IAIProvider {
  constructor(private readonly client: AITextCompletionClient) {}

  async suggestPrice(context: PriceSuggestionContext): Promise<PriceSuggestion> {
    const currentPrice = context.listing.price.amount;
    const raw = await this.client.complete({
      system: 'You output concise marketplace pricing recommendations as strict JSON.',
      prompt: `Current price: ${currentPrice} ${context.listing.price.currency}.`,
      jsonSchema: {
        type: 'object',
        properties: {
          suggestedPrice: { type: 'number' },
          reasoning: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['suggestedPrice', 'reasoning', 'confidence'],
      },
    });

    const parsed = this.parseJson(raw);
    return {
      suggestedPrice: this.asFiniteNumber(parsed?.suggestedPrice, currentPrice),
      reasoning: typeof parsed?.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided by Hermes.',
      confidence: this.asConfidence(parsed?.confidence),
    };
  }
}
```

`HermesCompletionClient` calls the native Hermes Agent API Server (`/v1/chat/completions`) on the same VPS. The Docker app reaches it via `host.docker.internal:8642`; Hermes keeps provider/model credentials centralized in `~/.hermes/`.

---

## 11. Event System

### Redis Streams Event Broker

```typescript
// infrastructure/eventBroker/RedisEventBroker.ts
export class RedisEventBroker implements IEventBroker {
  private redis: Redis;
  private subscribers: Map<string, (event: DomainEvent) => Promise<void>> = new Map();
  
  constructor(redisClient: Redis) {
    this.redis = redisClient;
  }
  
  async publish(event: DomainEvent): Promise<void> {
    const streamKey = `events:${event.aggregateType}`;
    
    // Add to stream
    await this.redis.xadd(
      streamKey,
      '*',
      'id', event.id,
      'type', event.type,
      'aggregateId', event.aggregateId,
      'payload', JSON.stringify(event.payload),
      'timestamp', event.timestamp.toISOString(),
      'version', event.version.toString()
    );
    
    // Publish to subscribers (pub/sub for real-time)
    await this.redis.publish(`event:${event.type}`, JSON.stringify(event));
  }
  
  subscribe(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    this.subscribers.set(eventType, handler);
  }
  
  async startConsuming(): Promise<void> {
    const subscriber = this.redis.duplicate();
    
    for (const [eventType, handler] of this.subscribers) {
      await subscriber.subscribe(`event:${eventType}`, (message) => {
        const event = JSON.parse(message);
        handler(event).catch(err => console.error(`Handler error: ${err}`));
      });
    }
  }
}
```

### Event Types & Publishing

```typescript
// domain/events/ folder
export class ProductCreatedEvent implements DomainEvent {
  id: string;
  aggregateType = 'Product';
  type = 'product.created';
  version = 1;
  
  constructor(
    public aggregateId: string,
    public payload: {
      productId: string;
      workspaceId: string;
      name: string;
      sku: string;
    },
    public timestamp: Date = new Date()
  ) {
    this.id = uuid();
  }
}

export class ListingPublishedEvent implements DomainEvent {
  id: string;
  aggregateType = 'Listing';
  type = 'listing.published';
  version = 1;
  
  constructor(
    public aggregateId: string,
    public payload: {
      listingId: string;
      productId: string;
      marketplaceKey: string;
      externalListingId: string;
      publishedAt: Date;
    },
    public timestamp: Date = new Date()
  ) {
    this.id = uuid();
  }
}

export class PriceChangedEvent implements DomainEvent {
  id: string;
  aggregateType = 'Listing';
  type = 'listing.price_changed';
  version = 1;
  
  constructor(
    public aggregateId: string,
    public payload: {
      listingId: string;
      oldPrice: number;
      newPrice: number;
      changedBy: 'user' | 'hermes';
      reason?: string;
    },
    public timestamp: Date = new Date()
  ) {
    this.id = uuid();
  }
}

// Publishing in domain service
class ListingService {
  publishListing(listing: Listing): Result<void> {
    // ... validation, external calls ...
    
    // Emit event
    this.eventPublisher.publish(
      new ListingPublishedEvent(listing.id, {
        listingId: listing.id,
        productId: listing.productId,
        marketplaceKey: listing.marketplace.key,
        externalListingId: listing.externalListingId,
        publishedAt: new Date(),
      })
    );
    
    return Ok(undefined);
  }
}
```

### Event Subscribers

```typescript
// application/subscribers/
export class SendNotificationOnListingPublished {
  constructor(
    private notificationService: NotificationService,
    private productRepo: ProductRepository
  ) {}
  
  async handle(event: ListingPublishedEvent): Promise<void> {
    const product = await this.productRepo.getById(event.payload.productId);
    await this.notificationService.send({
      type: 'listing_published',
      message: `"${product.name}" published on ${event.payload.marketplaceKey}`,
      userId: product.workspaceId,
    });
  }
}

export class LogPriceChangeToAnalytics {
  constructor(private analyticsRepo: AnalyticsRepository) {}
  
  async handle(event: PriceChangedEvent): Promise<void> {
    await this.analyticsRepo.recordEvent({
      type: 'price_change',
      listingId: event.payload.listingId,
      oldPrice: event.payload.oldPrice,
      newPrice: event.payload.newPrice,
      changedBy: event.payload.changedBy,
      timestamp: event.timestamp,
    });
  }
}

// Register subscribers in app startup
eventBroker.subscribe('product.created', productCreatedHandler.handle.bind(productCreatedHandler));
eventBroker.subscribe('listing.published', listingPublishedHandler.handle.bind(listingPublishedHandler));
eventBroker.subscribe('listing.price_changed', priceChangeHandler.handle.bind(priceChangeHandler));
```

---

## 12. Background Jobs

### Bull Job Queue

```typescript
// infrastructure/jobQueue/BullJobQueue.ts
import Queue from 'bull';

export class JobQueueService {
  private syncQueue: Queue.Queue;
  private publishQueue: Queue.Queue;
  private analyticsQueue: Queue.Queue;
  private hermesQueue: Queue.Queue;
  
  constructor(redisConfig: RedisOptions) {
    this.syncQueue = new Queue('marketplace-sync', redisConfig);
    this.publishQueue = new Queue('listing-publish', redisConfig);
    this.analyticsQueue = new Queue('analytics-aggregate', redisConfig);
    this.hermesQueue = new Queue('hermes-run', redisConfig);
    
    this.registerHandlers();
  }
  
  private registerHandlers(): void {
    // Sync handler
    this.syncQueue.process(async (job) => {
      const handler = new SyncMarketplaceHandler(
        this.adapterFactory,
        this.listingRepo,
        this.eventPublisher
      );
      return await handler.handle(job.data);
    });
    
    // Publish handler
    this.publishQueue.process(async (job) => {
      const handler = new PublishListingHandler(
        this.adapterFactory,
        this.listingRepo,
        this.productRepo
      );
      return await handler.handle(job.data);
    });
    
    // Analytics aggregation
    this.analyticsQueue.process(async (job) => {
      const handler = new AggregateAnalyticsHandler(this.analyticsRepo);
      return await handler.handle(job.data);
    });
    
    // Hermes run
    this.hermesQueue.process(async (job) => {
      const handler = new HermesRunHandler(this.hermesEngine, this.eventRepo);
      return await handler.handle(job.data);
    });
  }
  
  // Public API
  async enqueueSync(marketplaceId: UUID): Promise<void> {
    await this.syncQueue.add({ marketplaceId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      priority: 10,
    });
  }
  
  async enqueuePublish(listingId: UUID): Promise<void> {
    await this.publishQueue.add({ listingId }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: false,
      priority: 20,
    });
  }
  
  async enqueueAnalytics(workspaceId: UUID, period: 'hourly' | 'daily'): Promise<void> {
    await this.analyticsQueue.add({ workspaceId, period }, {
      attempts: 2,
      removeOnComplete: true,
      priority: 5,
    });
  }
  
  async enqueueHermesRun(workspaceId: UUID): Promise<void> {
    await this.hermesQueue.add({ workspaceId }, {
      attempts: 1,
      removeOnComplete: true,
      priority: 15,
    });
  }
  
  // Monitoring
  async getQueueStats(): Promise<{ [key: string]: QueueMetrics }> {
    return {
      sync: await this.getMetrics(this.syncQueue),
      publish: await this.getMetrics(this.publishQueue),
      analytics: await this.getMetrics(this.analyticsQueue),
      hermes: await this.getMetrics(this.hermesQueue),
    };
  }
  
  private async getMetrics(queue: Queue.Queue): Promise<QueueMetrics> {
    const counts = await queue.getJobCounts();
    return {
      active: counts.active,
      waiting: counts.wait,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
    };
  }
}
```

### Job Handlers Example

```typescript
// infrastructure/jobQueue/handlers/SyncMarketplaceHandler.ts
export class SyncMarketplaceHandler {
  constructor(
    private adapterFactory: MarketplaceAdapterFactory,
    private listingRepo: ListingRepository,
    private eventPublisher: IEventPublisher
  ) {}
  
  async handle(data: { marketplaceId: UUID }): Promise<void> {
    try {
      // 1. Load marketplace
      const marketplace = await this.marketplaceRepo.getById(data.marketplaceId);
      
      // 2. Get credentials
      const credentials = await this.credentialVault.retrieve(marketplace.id);
      
      // 3. Create adapter
      const adapter = this.adapterFactory.create(marketplace.key, credentials);
      
      // 4. Sync listings
      const listings = await this.listingRepo.findByMarketplace(marketplace.id);
      const externalIds = listings
        .filter(l => l.externalListingId)
        .map(l => l.externalListingId);
      
      const syncedData = await adapter.syncListings(externalIds);
      
      // 5. Update database
      for (const synced of syncedData) {
        const listing = listings.find(l => l.externalListingId === synced.externalListingId);
        if (listing) {
          listing.views = synced.views;
          listing.watchers = synced.watchers;
          listing.lastSyncAt = new Date();
          await this.listingRepo.save(listing);
        }
      }
      
      // 6. Emit event
      this.eventPublisher.publish(new MarketplaceSyncedEvent(marketplace.id, {
        synced: syncedData.length,
        errors: 0,
      }));
    } catch (error) {
      throw error; // Bull will retry
    }
  }
}
```

### Failure & Retry Strategy

```typescript
// Exponential backoff: 2s, 4s, 8s (attempt 1, 2, 3)
const jobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  // Move to dead-letter queue after max attempts
  removeOnFail: false,
};

// Monitor & alert on repeated failures
eventBroker.subscribe('job.failed', async (event) => {
  if (event.attempts >= 3) {
    await notificationService.send({
      type: 'job_failed',
      message: `Job ${event.jobType} failed after 3 attempts`,
      userId: event.workspaceId,
    });
  }
});
```

---

## 13. Scheduling and Durable Jobs

### Implemented strategy

MarketDesk uses Bull backed by Redis for durable work and repeatable schedules. `MarketplaceSyncScheduler` reconciles one deterministic repeatable job per connected hourly marketplace; `BullJobQueue` owns queue registration, retries and worker execution.

- `manual`: no repeatable job; synchronization requires an explicit action;
- `hourly`: one deterministic Bull repeatable job per connected marketplace;
- `realtime`: fails closed until verified marketplace webhooks are available.

The scheduling layer only enqueues durable work. Job handlers perform provider side effects and rely on queue retry/checkpoint behavior. Agenda/MongoDB and `node-cron` are not runtime dependencies.

Evidence: `src/backend/application/services/MarketplaceSyncScheduler.ts`, `src/backend/infrastructure/jobQueue/BullJobQueue.ts`, DI wiring, and `MarketplaceSyncScheduler.test.ts`.

## 14. Notification System

### Multi-Channel Notifications

```typescript
// application/services/NotificationService.ts
export class NotificationService {
  constructor(
    private emailProvider: EmailProvider,
    private telegramBot: TelegramBot,
    private notificationRepo: NotificationRepository,
    private workspaceRepo: WorkspaceRepository
  ) {}
  
  async send(notification: NotificationDTO): Promise<void> {
    const workspace = await this.workspaceRepo.getById(notification.workspaceId);
    const preferences = workspace.notificationSettings;
    
    // Check which channels are enabled for this event type
    const channels = this.determineChannels(notification.type, preferences);
    
    for (const channel of channels) {
      try {
        if (channel === 'email') {
          await this.emailProvider.send({
            to: workspace.ownerEmail,
            subject: this.formatSubject(notification),
            html: this.formatEmailBody(notification),
          });
        } else if (channel === 'telegram') {
          await this.telegramBot.send({
            chatId: workspace.telegramChatId,
            text: this.formatTelegramMessage(notification),
          });
        } else if (channel === 'push') {
          await this.sendPushNotification(workspace.id, notification);
        } else if (channel === 'in_app') {
          await this.notificationRepo.create({
            workspaceId: workspace.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            readAt: null,
          });
        }
      } catch (error) {
        console.error(`Failed to send via ${channel}:`, error);
        // Log failure but don't block other channels
      }
    }
  }
  
  private determineChannels(
    eventType: string,
    preferences: NotificationPreferences
  ): NotificationChannel[] {
    const channels: NotificationChannel[] = [];
    
    const matrix = preferences.notificationMatrix[eventType];
    if (!matrix) return ['in_app']; // Default to in-app
    
    if (matrix.email) channels.push('email');
    if (matrix.telegram) channels.push('telegram');
    if (matrix.push) channels.push('push');
    if (matrix.inApp !== false) channels.push('in_app');
    
    return channels;
  }
  
  private formatEmailBody(notification: NotificationDTO): string {
    // HTML template rendering
    return `<h2>${notification.title}</h2><p>${notification.message}</p>`;
  }
  
  private formatTelegramMessage(notification: NotificationDTO): string {
    return `${notification.title}\n${notification.message}`;
  }
}
```

### Event-Driven Notification Triggers

```typescript
// Subscribe to domain events and send notifications

eventBroker.subscribe('listing.published', async (event) => {
  await notificationService.send({
    workspaceId: event.payload.workspaceId,
    type: 'listing_published',
    title: 'Listing published',
    message: `"${event.payload.productName}" published on ${event.payload.marketplaceKey}`,
  });
});

eventBroker.subscribe('hermes_event.pending_review', async (event) => {
  await notificationService.send({
    workspaceId: event.payload.workspaceId,
    type: 'hermes_suggestion',
    title: event.payload.title,
    message: event.payload.detail,
  });
});

eventBroker.subscribe('marketplace.sync_error', async (event) => {
  await notificationService.send({
    workspaceId: event.payload.workspaceId,
    type: 'sync_error',
    title: 'Sync error on ' + event.payload.marketplaceName,
    message: event.payload.errorMessage,
  });
});
```

---

## 15. Audit Logging

### Immutable Audit Trail

```typescript
// infrastructure/persistence/repositories/ActivityLogRepository.ts
export class ActivityLogRepository {
  async log(entry: ActivityLogEntry): Promise<void> {
    // Append-only; never updated or deleted
    await db.query(
      `INSERT INTO activity_log 
       (workspace_id, entity_type, entity_id, actor_type, actor_id, action, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        entry.workspaceId,
        entry.entityType,
        entry.entityId,
        entry.actorType,
        entry.actorId,
        entry.action,
        JSON.stringify(entry.metadata),
      ]
    );
  }
  
  async getTrail(entityType: string, entityId: UUID): Promise<ActivityLogEntry[]> {
    const rows = await db.query(
      `SELECT * FROM activity_log
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [entityType, entityId]
    );
    
    return rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
    }));
  }
}
```

### What to Audit

```typescript
// Log these events:
- Product created/updated/deleted
- Listing published/unpublished/modified
- Price changes (with old & new values)
- Marketplace connected/disconnected
- Hermes event approved/dismissed
- User settings changed
- API key created/revoked
- Authentication events (login, logout, 2FA)
- Bulk operations
```

### GDPR Compliance

```typescript
// Retention policies
- User activity logs: 7 years (compliance requirement)
- Price history: Indefinite (business data)
- Auth logs: 1 year
- Deleted user data: Anonymize within 30 days of request

// Data export
async exportUserData(workspaceId: UUID): Promise<ExportFile> {
  const activities = await activityLogRepo.getByWorkspace(workspaceId);
  const products = await productRepo.findByWorkspace(workspaceId);
  const listings = await listingRepo.findByWorkspace(workspaceId);
  
  return {
    activities,
    products,
    listings,
    generatedAt: new Date(),
  };
}
```

---

## 16. Analytics Architecture

### Event Capture

```typescript
// domain/services/AnalyticsTracker.ts
export class AnalyticsTracker {
  constructor(private analyticsRepo: AnalyticsRepository) {}
  
  async recordListingEvent(listing: Listing, eventType: 'view' | 'message' | 'sale', quantity = 1): Promise<void> {
    await this.analyticsRepo.create({
      workspaceId: listing.product.workspaceId,
      listingId: listing.id,
      eventType,
      quantity,
      amount: eventType === 'sale' ? listing.price * quantity : null,
      occurredAt: new Date(),
    });
  }
}

// Triggered from event subscribers
eventBroker.subscribe('listing.viewed', async (event) => {
  await analyticsTracker.recordListingEvent(listing, 'view');
});

eventBroker.subscribe('listing.sold', async (event) => {
  await analyticsTracker.recordListingEvent(listing, 'sale', event.quantity);
});
```

### Aggregation Pipeline

```typescript
// application/services/AnalyticsAggregationService.ts
export class AnalyticsAggregationService {
  async aggregateDaily(workspaceId: UUID): Promise<void> {
    // Group events by hour, calculate metrics
    const hourlyMetrics = await db.query(`
      SELECT 
        DATE_TRUNC('hour', occurred_at) as hour,
        event_type,
        SUM(quantity) as total_quantity,
        SUM(amount) FILTER (WHERE event_type = 'sale') as revenue,
        COUNT(DISTINCT listing_id) as unique_listings
      FROM analytics_events
      WHERE workspace_id = $1 AND occurred_at >= NOW() - INTERVAL '24 hours'
      GROUP BY DATE_TRUNC('hour', occurred_at), event_type
    `, [workspaceId]);
    
    // Store aggregated data
    for (const metric of hourlyMetrics) {
      await this.metricsCache.set(`metrics:${workspaceId}:${metric.hour}`, metric);
    }
  }
  
  async getMetrics(workspaceId: UUID, period: 'daily' | 'monthly'): Promise<DashboardMetrics> {
    const startDate = period === 'daily' ? subDays(new Date(), 30) : subMonths(new Date(), 12);
    
    const results = await db.query(`
      SELECT 
        DATE_TRUNC($2, occurred_at) as period,
        SUM(amount) FILTER (WHERE event_type = 'sale') as revenue,
        SUM(quantity) FILTER (WHERE event_type = 'sale') as units_sold,
        SUM(quantity) FILTER (WHERE event_type = 'view') as views,
        SUM(quantity) FILTER (WHERE event_type = 'message') as messages
      FROM analytics_events
      WHERE workspace_id = $1 AND occurred_at >= $3
      GROUP BY DATE_TRUNC($2, occurred_at)
      ORDER BY period DESC
    `, [workspaceId, period === 'daily' ? 'day' : 'month', startDate]);
    
    return results;
  }
}
```

### Dashboard Queries

```typescript
// Fast cached queries for dashboard
const getDashboardMetrics = async (workspaceId: UUID) => {
  // Current month
  const thisMonth = await db.query(`
    SELECT 
      SUM(amount) as revenue,
      SUM(amount) - 
        (SELECT SUM(cost_price * quantity) FROM analytics_events 
         WHERE workspace_id = $1 AND event_type = 'sale' AND DATE_TRUNC('month', occurred_at) = DATE_TRUNC('month', NOW())) 
      as profit
    FROM analytics_events
    WHERE workspace_id = $1 AND DATE_TRUNC('month', occurred_at) = DATE_TRUNC('month', NOW())
  `, [workspaceId]);
  
  // Previous month delta
  const lastMonth = await db.query(`
    SELECT SUM(amount) as revenue FROM analytics_events
    WHERE workspace_id = $1 AND DATE_TRUNC('month', occurred_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
  `, [workspaceId]);
  
  return {
    thisMonthRevenue: thisMonth[0].revenue,
    lastMonthRevenue: lastMonth[0].revenue,
    delta: ((thisMonth[0].revenue - lastMonth[0].revenue) / lastMonth[0].revenue * 100),
  };
};
```

---

## 17. Authentication & Authorization

### JWT-based Authentication

```typescript
// application/auth/AuthService.ts
export class AuthService {
  constructor(
    private workspaceRepo: WorkspaceRepository,
    private jwtService: JWTService
  ) {}
  
  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify credentials (bcrypt hash)
    const user = await this.userRepo.findByEmail(email);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Generate tokens
    const accessToken = this.jwtService.sign(
      { userId: user.id, workspaceId: user.workspaceId },
      { expiresIn: '15m' }
    );
    
    const refreshToken = this.jwtService.sign(
      { userId: user.id, type: 'refresh' },
      { expiresIn: '7d' }
    );
    
    return { accessToken, refreshToken };
  }
  
  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const payload = this.jwtService.verify(refreshToken);
    
    if (payload.type !== 'refresh') {
      throw new AuthenticationError('Invalid token');
    }
    
    const newAccessToken = this.jwtService.sign(
      { userId: payload.userId, workspaceId: payload.workspaceId },
      { expiresIn: '15m' }
    );
    
    return { accessToken: newAccessToken };
  }
}
```

### Middleware Authentication

```typescript
// presentation/http/middleware/AuthMiddleware.ts
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authentication' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const payload = jwtService.verify(token);
    req.user = { id: payload.userId, workspaceId: payload.workspaceId };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
```

### API Keys for Third-Party

```typescript
// Application services can also authenticate via API key
export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (!apiKey) {
    return authMiddleware(req, res, next); // Fall back to JWT
  }
  
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const key = apiKeyRepo.findByHash(keyHash);
  
  if (!key) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  req.user = { id: 'api', workspaceId: key.workspaceId };
  next();
};
```

### Two-Factor Authentication

```typescript
// application/auth/TwoFactorService.ts
export class TwoFactorService {
  async enableTwoFactor(workspaceId: UUID): Promise<{ secret: string; qrCode: string }> {
    const secret = speakeasy.generateSecret({ name: 'MarketDesk' });
    
    await this.workspaceRepo.update(workspaceId, {
      twoFactorSecret: encrypt(secret.base32),
      twoFactorEnabled: true,
    });
    
    return {
      secret: secret.base32,
      qrCode: secret.qr_code_url,
    };
  }
  
  async verifyTwoFactor(workspaceId: UUID, token: string): Promise<boolean> {
    const workspace = await this.workspaceRepo.getById(workspaceId);
    const secret = decrypt(workspace.twoFactorSecret);
    
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 2,
    });
  }
}
```

### Authorization (Future: RBAC)

```typescript
// Currently: Single workspace owner
// Future: Multi-user with roles

export const authorizeAction = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role || 'viewer';
    
    const roleHierarchy = {
      admin: 3,
      editor: 2,
      viewer: 1,
    };
    
    if (roleHierarchy[userRole] < roleHierarchy[requiredRole]) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

app.post('/products', authorizeAction('editor'), productController.create);
```

---

## 18. API Design Philosophy

### REST Conventions

```
GET    /api/products              → List products (paginated, filterable)
POST   /api/products              → Create product
GET    /api/products/:id          → Get product details
PATCH  /api/products/:id          → Update product
DELETE /api/products/:id          → Delete product (soft or hard)

GET    /api/products/:id/listings → Get listings for product
POST   /api/marketplaces/:id/sync → Enqueue marketplace sync

POST   /api/hermes/events/:id/approve  → Approve suggestion
POST   /api/hermes/events/:id/dismiss  → Dismiss suggestion
```

### Request/Response Format

```typescript
// Successful response (200, 201)
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Product name",
    // ... fields
  }
}

// Error response (4xx, 5xx)
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description is too short",
    "details": [
      {
        "field": "description",
        "message": "Must be at least 20 characters"
      }
    ]
  }
}

// Paginated list
{
  "success": true,
  "data": [
    { id: "1", name: "..." },
    { id: "2", name: "..." }
  ],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 100,
    "totalPages": 4
  }
}
```

### Filtering & Sorting

```
GET /api/products?
  status=active,attention &
  priceMin=100&priceMax=1000 &
  tags=electronics,urgent &
  sort=-updatedAt,+name &
  limit=25&offset=0

```

### Rate Limiting

```typescript
// Public API: 100 req/min per IP
// Authenticated API: 1000 req/min per user
// Sensitive operations (price changes): 10 per min

const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.workspaceId || req.ip,
});

app.use('/api/', rateLimiter);
```

### Versioning

```
Current: /api/v1/
Future: /api/v2/ (when breaking changes needed)

Maintain v1 for 2 major releases, then deprecate
```

### OpenAPI Documentation

```typescript
// Auto-generated from code via @nestjs/swagger or swagger-jsdoc
/**
 * @openapi
 * /api/products:
 *   get:
 *     summary: List products
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [draft, active, attention, sold]
 *     responses:
 *       200:
 *         description: List of products
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
```

---

## 19. Error Handling Strategy

### Error Classification

```typescript
// Client errors (4xx)
class ValidationError extends ApplicationError {
  constructor(public message: string, public field?: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

class NotFoundError extends ApplicationError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

class AuthenticationError extends ApplicationError {
  constructor(message: string) {
    super(401, 'AUTHENTICATION_ERROR', message);
  }
}

class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

// Server errors (5xx)
class DatabaseError extends ApplicationError {
  constructor(message: string) {
    super(500, 'DATABASE_ERROR', message);
  }
}

class ExternalServiceError extends ApplicationError {
  constructor(service: string, message: string) {
    super(503, 'SERVICE_UNAVAILABLE', `${service}: ${message}`);
  }
}

// Transient errors (retry)
class RateLimitError extends ApplicationError {
  constructor(retryAfter: number) {
    super(429, 'RATE_LIMITED', `Retry after ${retryAfter}s`);
  }
}
```

### Retry Policy

```typescript
// Exponential backoff with jitter
async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry client errors
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      
      // Retry transient errors
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}
```

### Circuit Breaker for External APIs

```typescript
// Prevent cascading failures
const circuitBreaker = new CircuitBreaker(
  async () => marketplaceAdapter.sync(),
  {
    threshold: 0.5,  // Fail if 50% of requests fail
    timeout: 30000,  // 30s timeout
    volumeThreshold: 10, // Need 10+ requests to evaluate
    resetTimeout: 60000, // Try again after 60s
  }
);

try {
  await circuitBreaker.fire();
} catch (error) {
  if (error instanceof CircuitBreakerError) {
    // Circuit is open; marketplace is down
    await notificationService.send({
      type: 'marketplace_unavailable',
      message: `${marketplace.name} is currently unavailable`,
    });
  }
}
```

### Logging Strategy

```typescript
// Log errors with context
logger.error('Marketplace sync failed', {
  workspaceId,
  marketplaceId,
  marketplaceKey,
  error: error.message,
  stack: error.stack,
  attempt: retryCount,
  duration: endTime - startTime,
});
```

---

## 20. Future Scalability Considerations

### 1. Horizontal Scaling

**Current**: Single VPS instance
**Growth to 1000 users**: Load balancer + multiple API servers + shared DB

```
┌────────────┐
│  Nginx LB  │
└───────┬────┘
        │
    ┌───┴──────┬────────────┐
    │          │            │
┌───▼──┐  ┌──▼────┐  ┌────▼──┐
│API 1 │  │API 2  │  │API 3  │
└──────┘  └───────┘  └───────┘
         │
    ┌────▼──────────┐
    │ PostgreSQL    │
    │ (primary)     │
    └───────────────┘
         │
    ┌────▼──────────┐
    │ PostgreSQL    │
    │ (replica)     │
    └───────────────┘
```

### 2. Database Scaling

**Read replicas** for analytics queries
**Connection pooling** (PgBouncer) to manage connections
**Partitioning** large tables by workspace or time (analytics_events)
**Sharding** (future): by workspace_id for multi-tenancy at 10k+ users

```sql
-- Partition analytics by month
CREATE TABLE analytics_events_2026_01 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

### 3. Caching Strategy

```
L1: Application cache (Redis) - 5 min TTL
  - Product list per workspace
  - Marketplace list
  - User preferences

L2: HTTP cache headers
  - GET /products: public, max-age=300

L3: Browser cache
  - Static assets: 1 year
```

### 4. Concurrency Optimization

**Job Queue Scaling**:
- Bull workers can scale horizontally (multiple server instances processing same queue)
- Use `queue.process(concurrency)` to tune per-server parallelism

**WebSocket Scaling**:
- Use Redis Pub/Sub to broadcast events across servers
- Each server maintains WebSocket connections to its clients

### 5. Marketplace Integration Scaling

**Problem**: Sync 100k listings from OLX takes hours
**Solution**:
- Batch sync by marketplace (sync N listings in parallel)
- Use marketplace webhook APIs instead of polling (when available)
- Implement exponential backoff + circuit breaker

```typescript
// Sync 1000 listings in parallel batches of 100
const batchSize = 100;
for (let i = 0; i < externalIds.length; i += batchSize) {
  const batch = externalIds.slice(i, i + batchSize);
  await Promise.all(batch.map(id => adapter.syncListing(id)));
}
```

### 6. Analytics Scaling

**Problem**: Aggregating millions of analytics events is slow
**Solution**: Time-series database (TimescaleDB extension on PostgreSQL)

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert analytics_events to hypertable
SELECT create_hypertable('analytics_events', 'occurred_at', if_not_exists => TRUE);

-- Automatic compression for events older than 1 month
ALTER TABLE analytics_events SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'occurred_at DESC'
);

SELECT add_compression_policy('analytics_events', INTERVAL '1 month');
```

### 7. Search Scaling

**Problem**: Searching 100k products by name/SKU is slow
**Solution**: PostgreSQL Full-Text Search or Elasticsearch

```sql
-- Add GiST index for full-text search
CREATE INDEX idx_products_search ON products USING gist(
  to_tsvector('english', name || ' ' || description)
);

-- Query
SELECT * FROM products
WHERE to_tsvector('english', name || ' ' || description) @@ 
      plainto_tsquery('english', 'wireless headphones');
```

### 8. Deployment Scaling

**Docker Compose** (current): Single VPS
```yaml
services:
  api:
    image: marketdesk-api:latest
    replicas: 3
  frontend:
    image: marketdesk-frontend:latest
  postgres:
    image: postgres:15
  redis:
    image: redis:7
```

**Kubernetes** (10k+ users):
- Stateless API servers (auto-scale based on CPU)
- Persistent volumes for database
- Managed service mesh (Istio) for traffic management

### 9. Monitoring & Observability

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Prometheus   │   │  Grafana     │   │ ELK Stack    │
│ (metrics)    │   │ (dashboards) │   │ (logs)       │
└──────────────┘   └──────────────┘   └──────────────┘
     ▲                  ▲                     ▲
     │                  │                     │
     └──────────────┬───┴─────────────────────┘
                    │
            ┌───────▼────────┐
            │ Alert Manager  │
            │ (on-call)      │
            └────────────────┘

Metrics to track:
- API response times (p50, p95, p99)
- Job queue depth (backlog)
- Database connection pool usage
- Marketplace API rate limits
- Hermes run success rate
```

### 10. Disaster Recovery

**Backup Strategy**:
- Daily automated PostgreSQL backups (WAL archiving)
- Store backups in S3-compatible storage (MinIO)
- Test restoration monthly

**High Availability** (future):
- PostgreSQL streaming replication
- Automated failover via Patroni
- PgBouncer for connection pooling

---

## Appendix A: Technology Stack Summary

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Language** | TypeScript | Type safety, shared types frontend/backend |
| **Backend** | Node.js + Express | Fast iteration, JavaScript ecosystem, event-driven |
| **Frontend** | React 18 | Component reusability, large ecosystem, React Query |
| **State** | Redux + RTK Query | Scalable, normalized cache, optimistic updates |
| **UI Framework** | MUI Material | Production-grade, accessibility, theming |
| **Database** | PostgreSQL | ACID compliance, JSONB, excellent scaling |
| **Cache** | Redis | Fast in-memory, event broker, job queue backing |
| **Events** | Redis Streams | Simple, append-only, self-hosted friendly |
| **Jobs** | Bull + Redis | Node.js native, reliable, excellent for VPS |
| **Scheduler** | Bull repeatable jobs + Redis | Durable deterministic schedules share the existing queue/runtime |
| **AI** | Hermes Agent API Server | Uses the native Hermes instance on the same VPS; provider/model/tooling stays centralized |
| **Email** | SendGrid / Mailgun | Transactional reliability, SMTP fallback |
| **Telegram** | node-telegram-bot-api | Direct bot integration |
| **Auth** | JWT + bcrypt | Stateless, scalable, standard |
| **Encryption** | NaCl / libsodium | Fast, modern, audited library |
| **Testing** | Jest + Supertest | Excellent TypeScript support, fast |
| **Linting** | ESLint + Prettier | Code quality, consistent formatting |
| **CI/CD** | GitHub Actions | Integrated with repo, free for public |
| **Deployment** | Docker + Docker Compose | Reproducible, portable, scales to K8s |
| **IaC** | Terraform | Infrastructure as code for Hetzner VPS |

---

## Appendix B: Decision Matrix

| Decision | Chosen | Alternatives | Tradeoff |
|----------|--------|--------------|----------|
| **State Management** | Redux + RTK Query | Zustand, MobX | Redux is verbose but scales well with normalized cache |
| **Event System** | Redis Streams | RabbitMQ, Kafka | Streams are simpler, don't need separate broker |
| **Job Queue** | Bull | Agenda, RQ | Bull integrates with Redis; Agenda needs MongoDB |
| **Database** | PostgreSQL | MongoDB, MySQL | PG has JSONB (flexibility) + ACID (safety) |
| **Marketplace Abstraction** | Adapter pattern | Strategy, Factory | Adapter is industry standard; easy to understand |
| **Hermes AI** | Hermes Agent API Server | Direct vendor APIs, standalone app LLM key | Keeps MarketDesk on the same native Hermes runtime and avoids duplicating provider credentials |
| **Scheduler** | Bull repeatable jobs | Agenda, node-cron | Reuses durable Redis-backed jobs, retries and worker checkpoints |
| **Auth** | JWT | Session cookies, OAuth | JWT is stateless; OAuth adds complexity |
| **API Style** | REST | GraphQL | REST is simpler for CRUD; GraphQL overkill for v1 |

---

## Appendix C: Future Roadmap

**Phase 2 (Q3 2026)**:
- Multi-user accounts with role-based access control (RBAC)
- eBay, Etsy, Amazon adapter implementations
- Analytics API for third-party integrations
- Bulk operation history & rollback

**Phase 3 (Q4 2026)**:
- Webhooks for listing events (user can subscribe)
- Custom pricing rules engine (e.g., "always 10% above cost")
- Competitor price monitoring integration
- AI-powered product photography analyzer

**Phase 4 (2027)**:
- Mobile app (React Native)
- White-label reseller platform
- Advanced supply chain integration
- Inventory synchronization across warehouses

---

## Document Metadata

**Author**: Architecture Team  
**Date**: July 2026  
**Status**: Final for Implementation  
**Review**: Approved by Product & Engineering  
**Next Review**: December 2026
