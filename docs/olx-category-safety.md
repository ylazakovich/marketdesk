# OLX exact-category safety and correction boundary

OLX publication uses marketplace-specific leaf-category metadata, not the broad product category or `OLX_DEFAULT_CATEGORY_ID`. The persisted listing metadata contains the provider category ID, full readable path, source, confidence, leaf flag, and taxonomy verification/staleness timestamps. Publish preview and the final confirmation dialog show the exact provider ID and full path. Real publish fails closed when this metadata is missing, not a leaf, invalid, stale, low-confidence, or semantically contradictory to the product.

Import and sync preserve category metadata returned by OLX. A live semantic mismatch creates one `pending_review` Hermes recommendation and two independent rows in `category_correction_operations`:

1. `delist` — destructive operation with its own approval, lifecycle, result, and audit trail. Its successful result always records `quotaUnitsRestored: 0` and `deletionRestoresQuota: false`.
2. `recreate` — new-publication operation with its own approval, lifecycle, result, and audit trail. Its target is the exact proposed leaf category.

The parent recommendation still cannot be approved as one combined action. Authenticated workspace-scoped workflows are available at:

- `GET /api/hermes/events/:eventId/category-correction-operations`;
- `POST /api/hermes/category-correction-operations/:operationId/approve`;
- `POST /api/hermes/category-correction-operations/:operationId/execute`.

A paid-risk acceptance is valid only on approval of one `recreate` operation and requires a non-empty operator reason. It is persisted on that operation; execute accepts no override body and therefore cannot broaden or reuse an override accidentally.

## Durable execution order

Each provider effect follows `requested → approved → executing → executed|failed`. The repository claims `approved → executing` atomically before any effect. Repeated calls return a terminal record without repeating the provider request. An interrupted `executing` record is not automatically re-entered because the remote outcome may be ambiguous; it fails closed for manual reconciliation.

For recreate, execution performs the following order:

1. load tenant-scoped operation, listing, product, and marketplace;
2. validate the persisted exact target category;
3. call `OlxPublicationQuotaService.authorize` with the same operation ID and `mode: recreate`;
4. stop before the adapter when quota is unknown, stale, exhausted, or otherwise blocked;
5. allow an override only when it was explicitly persisted for this operation;
6. only then call the authenticated OLX adapter and persist the result.

Ending or deleting an advert does **not** restore its consumed publication unit. An advert's visible 30-day lifetime is not the OLX quota cycle and is not evidence that a free recreate slot exists.

The migration and tests do not perform live OLX actions, use credentials, or mutate a production database. Real adapter effects remain controlled by the existing live-effect configuration and require an authenticated operator request.
