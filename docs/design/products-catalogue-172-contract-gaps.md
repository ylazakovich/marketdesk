# Products catalogue #172 — contract gaps

The native catalogue intentionally exposes only behavior supported by current authenticated workspace contracts.

## Deferred filters and read model fields

`GET /api/products` supports `search`, `status`, `priceMin`, `priceMax`, `tags`, `sort`, `limit`, and `offset`. It does not expose marketplace, margin, views, or updated-date filters, and its product rows do not include listing/marketplace counts. The UI therefore labels marketplace count as unavailable and does not offer unsupported filters or sort keys.

A follow-up needs a server-owned catalogue read model (or explicit list-query extensions) for marketplace counts and the missing filter/sort operands. Counts must be computed before pagination and scoped to the authenticated workspace.

## Deferred bulk writes

Current mutations are single-resource `PATCH /api/products/:id` and `DELETE /api/products/:id`. They provide no atomic batch request, generation/version fence, transaction boundary, rollback result, or per-item durable operation status. Sequentially calling them from the browser can leave a partially applied selection and is especially unsafe for deletion and below-cost price changes.

Accordingly, bulk Add tag, Edit price, and Delete are visible but disabled with an explanation. CSV export is enabled because it is read-only. A safe follow-up contract must:

- accept an explicit bounded set of product IDs in one workspace;
- validate every target and the final price/tag state before applying effects;
- preserve the existing explicit below-cost confirmation requirement and audit evidence;
- define all-or-nothing semantics, or return a durable operation with truthful per-item terminal results and retry/idempotency behavior;
- protect against concurrent product updates with a version/generation fence;
- define listing dependencies before product deletion.
