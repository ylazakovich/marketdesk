# MarketDesk - Multi-Marketplace Product Management Platform

A workspace-scoped platform for managing products, listings, marketplace state, analytics, and Hermes-assisted decisions. OLX is the only validated live marketplace integration today; other channels remain explicit roadmap surfaces.

## Overview

MarketDesk is an integrated product and listing management system designed to simplify multi-marketplace operations. It provides:

- **Product Management**: Create and manage products with detailed attributes and pricing
- **Marketplace Listings**: Publish and synchronize OLX listings behind guarded provider contracts; additional channels are roadmap work
- **Inventory Tracking**: Real-time inventory management with history tracking
- **Price Management**: Dynamic pricing with history and optimization capabilities
- **Event Processing**: Real-time event handling with the Hermes event system
- **Activity Audit**: Complete audit trails for compliance and monitoring
- **Workspace Management**: Multi-tenant architecture with role-based access control

## Tech Stack

### Backend

- **Runtime**: Node.js 22+
- **Language**: TypeScript with ES2020 target
- **Framework**: Express.js 5
- **Database**: PostgreSQL 18 (Docker image pinned by digest)
- **Cache**: Redis 8 (Docker image pinned by digest)
- **Queue**: Bull (Job Queue)
- **Validation**: Zod (HTTP boundary) + domain invariants
- **Authentication**: JWT (bcryptjs password hashing)

### Frontend

- **Framework**: React 19
- **State Management**: Redux Toolkit
- **Routing**: React Router v7
- **UI Framework**: Material-UI (MUI) 6
- **Data Fetching**: RTK Query (endpoints injected into a shared base API)
- **Charts**: Recharts 3
- **Build Tool**: Vite 6

### Infrastructure

- **Containerization**: Docker & Docker Compose
- **Deployment**: Self-hosted on Hetzner VPS
- **Architecture**: Layered (Domain, Application, Infrastructure, Presentation)

## Project Structure

```
.
├── src/
│   ├── backend/
│   │   ├── config/              # Configuration files
│   │   ├── domain/              # Domain models and business logic
│   │   ├── application/         # Application services and use cases
│   │   ├── infrastructure/      # External services, repositories
│   │   ├── presentation/        # API routes and controllers
│   │   ├── persistence/         # Database migrations and schema
│   │   ├── shared/              # Shared utilities and types
│   │   └── main.ts              # Entry point
│   ├── frontend/
│   │   ├── pages/               # Page components
│   │   ├── components/          # Reusable components
│   │   ├── state/               # Redux store and slices
│   │   ├── services/            # API services
│   │   ├── theme/               # Theme configuration
│   │   ├── utils/               # Utility functions
│   │   ├── types/               # Frontend types
│   │   ├── hooks/               # Custom React hooks
│   │   ├── App.tsx              # Root component
│   │   └── main.tsx             # Entry point
│   └── shared/
│       ├── types/               # Shared type definitions
│       ├── constants/           # Constants used across app
│       └── utils/               # Shared utility functions
├── docs/
│   ├── spec/                    # Maturity, traceability and delivery workflow
│   └── design/                  # Static PRD/design prototype and screenshots
├── docker-compose.yml           # Docker Compose configuration
├── Dockerfile                   # Docker build configuration
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── vite.config.ts               # Vite configuration
├── jest.config.js               # Jest testing configuration
└── README.md                    # This file
```

## Deployment Docs

- [Caddy + Cloudflare VPS deployment](docs/deployment/caddy-cloudflare-vps.md) — production HTTPS reverse-proxy setup for the `hosting/domain provider → Cloudflare DNS → Caddy → VPS → MarketDesk` path.
- [Upload storage initialization and recovery](docs/deployment/upload-storage.md) — non-root Compose startup, expected ownership, safe recovery, and upload/read/restart/delete verification.
- [Installed release version](docs/deployment/release-version.md) — exact-tag artifact metadata, fail-closed Compose deployment, runtime/UI contract, and smoke verification.
- [OLX publication quota guard](docs/olx-publication-quota.md) — operator workflow, fail-closed decisions, explicit overrides, and concurrency semantics.

## Design & Product Docs

Static design artifacts live under `docs/design/` and are excluded from Docker builds:

- `docs/design/MarketDesk PRD.dc.html` — product requirements document
- `docs/design/MarketDesk.dc.html` — high-fidelity navigable design prototype
- `docs/design/screenshots/` — curated screenshots for visual reference:
  - [Products](docs/design/screenshots/products.png)
  - [Analytics](docs/design/screenshots/analytics.png)
  - [Dark theme](docs/design/screenshots/dark.png)
- `docs/design/_ds/`, `doc-page.js`, `support.js` — local runtime/design-system assets required by the HTML docs

Read [`docs/spec/README.md`](docs/spec/README.md) for the authoritative source hierarchy. The original PRD remains the product behavior and acceptance contract; [`ARCHITECTURE.md`](ARCHITECTURE.md) is the canonical architecture, while [`ARCHITECTURE_AMENDMENTS.md`](ARCHITECTURE_AMENDMENTS.md) is only its historical review/decision record. [`docs/spec/PRODUCT.md`](docs/spec/PRODUCT.md) records current maturity and approved deviations, and [`docs/spec/TRACEABILITY.md`](docs/spec/TRACEABILITY.md) maps requirements and cross-cutting decisions to implementation evidence and active issues.

Preview the HTML files by opening them directly in a browser from the repository checkout.

## Prerequisites

- **Node.js**: v22.0.0 or higher
- **npm**: v10.0.0 or higher
- **Docker**: Latest version
- **Docker Compose**: Latest version

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd hermes-marketdesk
npm install
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Required
NODE_ENV=development
DATABASE_URL=postgresql://marketdesk:marketdesk@localhost:5432/marketdesk
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_jwt_secret_key_change_in_production

# Hermes Agent API Server (native Hermes on the same VPS)
HERMES_API_URL=http://host.docker.internal:8642/v1
HERMES_API_KEY=your_local_hermes_api_server_key
HERMES_MODEL=hermes-agent
```

### 3. Enable native Hermes Agent API Server

MarketDesk does not call Claude/Anthropic directly. It calls the native Hermes Agent API Server running on the same VPS, and Hermes owns provider/model/tool execution.

Add the matching server-side key to `~/.hermes/.env` and restart Hermes gateway:

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=<same value as HERMES_API_KEY in this project's .env>
```

The Docker app reaches the host Hermes server through `host.docker.internal:8642`. Because this binds Hermes on a host-reachable interface for Docker, restrict port `8642` at the firewall/security-group level to local Docker traffic and trusted admin IPs only; authentication still requires the bearer `API_SERVER_KEY`.

### 4. Start with Docker Compose

```bash
# Start all services (PostgreSQL, Redis, Node app serving API + built SPA)
docker compose up -d

# Or bring up just the data stores (useful for local backend dev):
docker compose up -d postgres redis

# Check status
docker compose ps

# View logs
docker compose logs -f app
```

The `app` image builds both the backend (`dist/backend`) and the frontend
(`dist/frontend`); the backend serves the SPA, so once healthy the full application
is available at `http://localhost:3000` (API under `/api`).

Compose first runs a one-shot root initializer for the fixed `./uploads:/app/uploads`
bind mount. It preserves existing workspace and legacy uploads, assigns them to the
image's UID/GID `1001:1001`, and must complete before the non-root app starts. The app
also proves storage write/delete access before listening. See
[Upload storage initialization and recovery](docs/deployment/upload-storage.md) for
ownership checks, safe recovery, and the credential-free verification procedure.

> PostgreSQL 18 stores its cluster under `/var/lib/postgresql`. Before deploying
> this Compose file over an existing pre-18 `postgres_data` volume, create a
> database dump/backup and restore it into a fresh PG18 volume; otherwise Docker
> will initialize a new empty cluster at the new mount path.

> Redis auth: `REDIS_PASSWORD` is empty by default (no auth). Set it in `.env` to a
> non-empty value to enable `--requirepass`; the app authenticates with the same
> value automatically. Leaving it empty starts Redis cleanly without a password.

### 4. Verify Setup

```bash
# Health check
curl http://localhost:3000/health

# Readiness check
curl http://localhost:3000/ready
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 45.123
}
```

## Development

### Local Development (Without Docker)

```bash
# Install dependencies
npm install

# Set up .env for local development
cp .env.example .env
# Update DATABASE_URL and REDIS_URL to point to local services

# Start PostgreSQL and Redis locally, then:
npm run dev
```

This will start:

- Backend server on http://localhost:3000
- Frontend dev server on http://localhost:5173

### Build

```bash
# Full build
npm run build

# Backend only
npm run build:backend

# Frontend only
npm run build:frontend
```

### Available Scripts

```bash
# Development
npm run dev              # Start both backend and frontend in dev mode
npm run dev:backend     # Start backend only
npm run dev:frontend    # Start frontend only

# Building
npm run build           # Build both backend and frontend
npm run build:backend   # Build backend TypeScript
npm run build:frontend  # Build frontend with Vite

# Running
npm start               # Start production server

# Database
npm run db:migrate      # Run database migrations
npm run db:seed         # Seed database with sample data

# Quality
npm run lint            # Run ESLint
npm run format          # Format code with Prettier
npm run type-check      # Type check TypeScript

# Testing
npm test                # Run the full Jest suite (unit + integration + e2e)
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
```

### Tests

The Jest suite covers domain/application unit tests, presentation HTTP integration
tests (supertest against `buildApp(deps)`), and end-to-end flow tests. **The suite
runs fully in-memory and does NOT require a live Postgres or Redis** — the e2e tests
(`src/backend/__tests__/e2e/`) compose the real application services, use cases and
domain services over in-memory repositories with a synchronous publish queue, and
drive the flow over HTTP: `login → me → create product → list → publish listing →
run Hermes → approve event → verify applied`.

Any future DB-backed integration tests should be gated behind `DATABASE_URL` and skip
cleanly when it is absent; CI provisions Postgres + Redis service containers for them.

```bash
npx jest                                   # full suite
npx jest src/backend/__tests__/e2e         # e2e flow only
npx tsc --noEmit -p tsconfig.backend.json  # typecheck backend
npx tsc --noEmit -p tsconfig.json          # typecheck frontend + shared
```

### Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `main`: install (npm cached),
lint (reported, non-blocking — see Known Issues), typecheck (both tsconfigs), the
Jest suite (with Postgres + Redis service containers available), and the frontend +
backend builds. Any step except lint fails the build.

### Known Issues

- A small number of **pre-existing** ESLint errors remain in files outside the
  current change set (`src/backend/config/database.ts`, `src/backend/config/redis.ts`,
  `src/backend/persistence/seed.ts`, `src/shared/utils/index.ts`): unused imports and
  one `no-prototype-builtins`. The CI lint step is therefore non-blocking; new code is
  expected to be lint-clean.

## Database

### Migrations

Migrations are located in `src/backend/persistence/migrations/` as numbered SQL files:

1. `001_workspaces_and_users.sql` - Workspaces, users and auth foundations
2. `002_products.sql` - Products and inventory
3. `003_marketplaces.sql` - Marketplace connections
4. `004_listings_and_price_history.sql` - Listings and price history
5. `005_hermes_events.sql` - Hermes event system
6. `006_activity_analytics_apikeys.sql` - Activity logs, analytics and API keys
7. `007_add_workspace_guardrails.sql` - Workspace guardrails for Hermes decisions

### Running Migrations

Migrations are automatically run when the PostgreSQL container starts. To manually run migrations:

```bash
npm run db:migrate
```

### Full Schema

For a complete view of the database schema, see `src/backend/persistence/schema.sql`.

### Connecting to Database

```bash
# Using Docker
docker compose exec postgres psql -U marketdesk -d marketdesk

# Or locally if PostgreSQL is installed
psql -h localhost -U marketdesk -d marketdesk
```

## Docker

### Build Docker Image

```bash
docker build -t hermes-marketdesk:latest .
```

### Docker Compose Services

```yaml
- postgres: PostgreSQL 18
- redis: Redis 8
- app: Node.js application
```

### Docker Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f redis
```

### Cleanup

```bash
# Stop all services
docker compose down

# Remove volumes
docker compose down -v

# Rebuild images
docker compose build --no-cache
```

## API Endpoints

### Health & Status (owned by the process, not the API layer)

- `GET /health` - Liveness check
- `GET /ready` - Readiness check (verifies DB + Redis connectivity)

### API (all under `/api`, envelope `{ success, data, ... }`)

Auth is public; every other resource is JWT-protected and workspace-scoped
(the JWT carries `{ userId, workspaceId }`).

- **Auth** (public): `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`
- **Products**: `GET|POST /api/products`, `GET|PATCH|DELETE /api/products/:id`, `GET /api/products/:id/listings`
- **Listings**: `GET /api/listings`, `GET /api/listings/:id`, `GET /api/listings/:id/price-history`, `PATCH /api/listings/:id`, `POST /api/listings/:id/publish`, `POST /api/listings/:id/relist`
- **Marketplaces**: `GET /api/marketplaces`, `GET /api/marketplaces/:id`, `POST /api/marketplaces/:id/sync`, `POST /api/marketplaces/:id/connect`, `PATCH /api/marketplaces/:id`
- **Hermes** (autonomous agent): `GET /api/hermes/events`, `GET /api/hermes/events/:id`, `POST /api/hermes/events/:id/approve`, `POST /api/hermes/events/:id/dismiss`, `POST /api/hermes/run`
- **Analytics**: `GET /api/analytics/overview`, `GET /api/analytics/revenue`, `GET /api/analytics/listings`
- **Workspaces**: `GET /api/workspaces/:id`, `PATCH /api/workspaces/:id`
- **Realtime**: Hermes live updates WebSocket at `/api/hermes/live`

### Frontend

In Docker (single-service) the backend serves the built SPA (`dist/frontend`) on the
same port, so the whole app is at `http://localhost:3000`. In local dev the frontend
runs on the Vite dev server at `http://localhost:5173` and proxies `/api` to `:3000`.

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.

**Critical Variables**:

- `DATABASE_URL` - optional PostgreSQL connection string for an external/managed
  endpoint. Leave empty to use the individual `DB_*` settings.
- `DB_SSL_MODE` - PostgreSQL transport mode: `disable` for local/internal Compose,
  or `verify-full` for verified TLS. Production requires an explicit value; this
  setting is authoritative over any TLS query parameters in `DATABASE_URL`.
  Compose preserves an explicitly configured external `DATABASE_URL`; when it is
  empty, Compose targets its bundled `postgres` service even when the copied
  `.env` keeps `DB_HOST=localhost` for native development.
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret key for JWT signing

**Feature Flags**:

- `ENABLE_BULK_OPERATIONS` - Enable bulk operation features
- `ENABLE_PRICE_OPTIMIZATION` - Enable AI-based price optimization
- `ENABLE_INVENTORY_SYNC` - Enable automatic inventory synchronization

## Development Workflow

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make changes following the layered architecture
3. Run tests and linting: `npm run lint && npm run test`
4. Format code: `npm run format`
5. Commit with meaningful messages
6. Push and create a pull request

## Architecture

### Layering

The backend follows strict layering principles:

- **Domain Layer**: Core business logic, entities, and value objects
- **Application Layer**: Use cases, services, and orchestration
- **Infrastructure Layer**: External services, repositories, adapters
- **Presentation Layer**: HTTP routes, request/response handling

**Rule**: Lower layers cannot import from higher layers (Domain → Application → Infrastructure → Presentation)

### Workspace Multi-Tenancy

The platform is built with multi-tenancy in mind:

- Each workspace is isolated
- Users can belong to multiple workspaces
- All data is scoped to workspace_id

## Security

- Passwords hashed with bcryptjs
- JWT-based authentication
- Role-based access control (RBAC)
- CORS configuration per environment
- Helmet.js for HTTP security headers
- HTTPS in production (via reverse proxy)

## Monitoring & Logging

- Structured logging with Pino
- Activity audit trails
- Access logs
- Error tracking and reporting
- Performance metrics

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# View PostgreSQL logs
docker compose logs postgres

# Connect to PostgreSQL
docker compose exec postgres psql -U marketdesk -d marketdesk
```

### Redis Connection Issues

```bash
# Check if Redis is running
docker compose ps redis

# Test Redis connection
docker compose exec redis redis-cli ping
```

### Port Already in Use

If port 3000 or 5173 is already in use:

```bash
# Change ports in docker-compose.yml and .env
# Or kill existing processes
lsof -ti:3000 | xargs kill -9
```

## Performance Optimization

- Connection pooling for PostgreSQL (min: 2, max: 10)
- Redis caching for frequently accessed data
- Database indexes on foreign keys and common queries
- Lazy loading for large datasets
- Code splitting in frontend with Vite

## Contributing

1. Follow the existing code style and structure
2. Write tests for new functionality
3. Update documentation for API changes
4. Keep commits atomic and well-described

## License

UNLICENSED - Internal use only

## Support

For issues, questions, or feature requests, please open an issue on the GitHub repository.
