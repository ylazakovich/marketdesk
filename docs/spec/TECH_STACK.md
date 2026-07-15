# Tech stack

- Frontend: React, Vite, TypeScript, MUI, Redux Toolkit / RTK Query.
- Backend: Node.js, Express, TypeScript, domain/application/infrastructure layering.
- Persistence: PostgreSQL, Redis-backed queues, filesystem uploads as transient staging where required.
- Marketplace integration: adapter interfaces with OLX as the currently validated real integration.
- Testing: Jest plus integration tests around API, queues, adapters, and frontend components.

Architecture rule: provider-specific payloads stay behind adapters/services; frontend and controllers use shared typed contracts from `src/shared/types`.
