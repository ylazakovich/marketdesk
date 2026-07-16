# Architecture review decision record

**Review date:** July 2026
**Status:** Historical review record; not an active overlay over `ARCHITECTURE.md`.

This document preserves the findings from the architecture review and records what actually happened to each proposal. The canonical architecture is `ARCHITECTURE.md`; runtime truth is the current code, migrations and tests. An item marked **Accepted target** is not implemented merely because it appears here.

Status vocabulary:

- **Implemented** — present in current code/schema with tests or executable evidence and consolidated into `ARCHITECTURE.md`.
- **Accepted target** — approved direction, but current runtime still differs; the linked issue owns delivery.
- **Superseded** — the concern was resolved using a different implementation than the original proposal.
- **Rejected** — deliberately not adopted.

## Decision register

| Fix | Review finding / original proposal | Decision | Current evidence and links |
| --- | --- | --- | --- |
| 1 | Abstract the LLM provider behind `IAIProvider` and use Hermes Agent through an adapter. | **Implemented** | `src/backend/domain/ports/IAIProvider.ts`, `src/backend/infrastructure/external/HermesAI.ts`, `HermesCompletionClient.ts`, DI wiring and `HermesAI.test.ts`; delivered in [PR #162](https://github.com/ylazakovich/hermes-marketdesk/pull/162). |
| 2 | Adopt `node-pg-migrate`, reversible `up/down` files and a deployment integration. | **Superseded**; `node-pg-migrate` is not adopted. | Current strategy is ordered, idempotent SQL in `src/backend/persistence/migrations/`, executed by `src/backend/persistence/migrate.ts`. Concurrent-index migrations are serialized with PostgreSQL advisory locks. There is currently no migration ledger or automatic down migration; production changes require backup plus forward recovery. `package.json` intentionally contains no `node-pg-migrate`. |
| 3 | Replace contradictory Agenda/MongoDB examples with `node-cron`. | **Superseded**; neither Agenda nor `node-cron` is the runtime scheduler. | Hourly marketplace synchronization uses deterministic Bull/Redis repeatable jobs through `MarketplaceSyncScheduler.ts` and `BullJobQueue.ts`; covered by `MarketplaceSyncScheduler.test.ts`. Manual mode is explicit-action only and realtime mode fails closed until verified provider webhooks exist. |
| 4 | Introduce a durable Hermes lifecycle (`pending_decision`, `pending_review`, `applying`, `applied`, `dismissed`, `failed`, `reverting`, `reverted`). | **Implemented**. | Distinct `applying` and `reverting` states preserve forward-versus-undo intent across persistence. `HermesEvent.ts`, shared API types, migration `020_hermes_event_lifecycle.sql`, approve/dismiss/decision use cases, UI badge mapping and transition/API tests; delivered by [issue #178](https://github.com/ylazakovich/hermes-marketdesk/issues/178). |
| 5 | Persist configurable workspace guardrails and use them in Hermes decisions. | **Implemented**. | `Workspace.ts`, `007_add_workspace_guardrails.sql`, `WorkspaceRepository.ts`, `WorkspaceMapper.ts`, `HermesDecisionEngine.ts`, mapper/decision-engine tests. Settings UX remains separately tracked by [issue #142](https://github.com/ylazakovich/hermes-marketdesk/issues/142). |
| 6 | Replace invalid inline-index/encryption pseudo-DDL with valid PostgreSQL and encrypted credential bytes. | **Superseded** in storage shape; the security objective is implemented. | Canonical executable sources are `src/backend/persistence/schema.sql` and ordered migrations. Credentials are encrypted by `AesGcmCredentialVault` into an authenticated envelope and that ciphertext envelope is persisted as JSONB, rather than using the proposed `BYTEA` column. Repository/vault tests cover the boundary. `ARCHITECTURE.md` now points to executable sources instead of duplicating stale pseudo-DDL. |
| 7 | Snapshot `cost_at_sale` and calculate profit from fields that exist. | **Implemented**. | `006_activity_analytics_apikeys.sql`, `schema.sql`, analytics entities/repositories/services and `AnalyticsApplicationService.test.ts`; PRD analytics delivery remains tracked by [issue #173](https://github.com/ylazakovich/hermes-marketdesk/issues/173). |
| 8 | Remove WebSocket callback variable shadowing from the illustrative code. | **Implemented**. | Baseline example corrected in `ARCHITECTURE.md`; live transport behavior is covered by `HermesLiveUpdates.test.ts`. |
| 9 | Correct the product application-service return type. | **Implemented**. | Baseline example now returns `Promise<Result<Product>>`; current create/update use cases return domain `Result` values and are covered by use-case/API tests. |
| 10 | Inject every `SyncMarketplaceHandler` dependency explicitly. | **Implemented**. | Current handler receives its repositories, adapter/auth dependencies and publisher through DI; job-handler and container tests exercise the wiring. |

## Resolved platform strategies

### Database evolution

MarketDesk uses forward-only, ordered, idempotent SQL migrations. The migration runner executes files lexically; ordinary migrations run through PostgreSQL, while concurrent-index files run outside a transaction under an advisory lock. This is the **implemented strategy**, not a claim of rollback support.

Before production schema mutation:

1. create and verify a live-data backup;
2. run the ordered migrations;
3. verify schema-dependent flows plus `/health` and `/ready`;
4. recover forward from the verified backup if needed.

A future migration-ledger or reversible framework requires a separate decision and migration plan; documentation must not claim it already exists.

### Scheduling

MarketDesk uses Bull backed by Redis for durable work and repeatable hourly synchronization. The scheduler only reconciles deterministic repeatable jobs; workers perform the side effects with queue retry behavior. Agenda/MongoDB and `node-cron` examples are historical proposals and must not be copied into runtime code.

### Hermes lifecycle

The seven-state lifecycle is now canonical across database, API, domain and UI. Existing rows are validated but never rewritten by migration 020. Product labels such as “Action needed” or “Completed” map to canonical enum values in the presentation layer.

## Precedence

1. `docs/design/MarketDesk PRD.dc.html` — product acceptance contract.
2. `ARCHITECTURE.md` — canonical architecture, annotated with implemented versus target state.
3. `docs/spec/PRODUCT.md` — approved product deviations and maturity constraints.
4. `docs/spec/TRACEABILITY.md`, GitHub issues and merged PRs — delivery evidence.
5. This file — historical review decisions only.

Do not use an old code block from this record as implementation authority. Verify `ARCHITECTURE.md`, current code, migrations and tests first.
