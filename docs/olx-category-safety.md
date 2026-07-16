# OLX exact-category safety and correction boundary

OLX publication uses marketplace-specific leaf-category metadata, not the broad product category or `OLX_DEFAULT_CATEGORY_ID`. The persisted listing metadata contains the provider category ID, full readable path, source, confidence, leaf flag, and taxonomy verification/staleness timestamps. Publish preview and the final confirmation dialog show the exact provider ID and full path. Real publish fails closed when this metadata is missing, not a leaf, invalid, stale, low-confidence, or semantically contradictory to the product.

Import and sync preserve category metadata returned by OLX. A live semantic mismatch creates one `pending_review` Hermes recommendation per listing/current/proposed category tuple. The recommendation contains **two separate durable intent descriptions**:

1. `delist` — `pending_review`, destructive provider side effects explicitly disabled, and `quotaUnitsRestored: 0`;
2. `recreate` — `blocked_pending_quota_review`, provider side effects explicitly disabled, and exact-subcategory quota authorization required.

Approving the parent recommendation is refused and audited; it never sends a category `PUT`, delists, or recreates an advert. This issue intentionally does not expose an execution endpoint for either intent. A future reviewed workflow must persist each operation's lifecycle independently, explicitly enable its provider effect, and call the same quota authorization ledger with `mode: recreate` before any new advert is created. Unknown, stale, or exhausted quota remains blocking unless an authenticated operator supplies an explicit operation-scoped paid-risk override.

Ending or deleting an advert does **not** restore its consumed publication unit. An advert's visible 30-day lifetime is not the OLX quota cycle and is not evidence that a free recreate slot exists. No live OLX action, credential use, or production database mutation is part of this implementation.
