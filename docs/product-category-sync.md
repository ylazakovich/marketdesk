# Marketplace product category synchronization

MarketDesk may synchronize `Product.category` from marketplace listing evidence during OLX import and manual or scheduled sync.

## Trust boundary

Automatic synchronization is currently OLX-only. Evidence is accepted only when the listing category:

- comes from the provider taxonomy;
- is an exact leaf with a provider category ID and full non-empty path;
- has confidence at or above the OLX guard threshold (`0.8`);
- has a valid, non-stale taxonomy verification window;
- is semantically compatible with stable product identity (`name` and `description`). The current `Product.category` is deliberately excluded from this check so a stale category cannot block its own correction.

Missing, partial, stale, invalid, or unsupported-provider evidence never clears the current product category or its last accepted source.

## Reconciliation and concurrency

Import and sync use one centralized reconciliation service. Listing evidence is persisted and the product is reconciled in the same database transaction. The product row is locked with `FOR UPDATE`; all active listings for the product are evaluated before a decision is made.

- All accepted candidates agree: set the exact leaf name and persist all agreeing sources.
- Candidates disagree: keep the current category, persist a conflict state, and create one idempotent `product_category_conflict` Hermes review event.
- Replaying the same evidence: no product write, `updatedAt` change, duplicate activity, or duplicate review event.

A source records marketplace key/id, listing id, provider category id, exact name/full path, taxonomy verification time, and synchronization time. Conflict provenance retains the sources supporting the currently accepted category while exposing all conflicting candidates.

Manual category edits clear marketplace provenance. Conflict events are dismiss-only; MarketDesk does not choose or apply a winner automatically.

## API and UI

Product DTOs expose `categoryProvenance` as either `null`, `synced`, or `conflict`. Product tables and listing details show the marketplace, exact path, provider ID, and conflict review state.
