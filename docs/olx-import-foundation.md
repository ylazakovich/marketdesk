# OLX import/adopt workflow foundation

Issue #99 is larger than a single safe backend patch. This document defines the first implementation boundary added here: a read-only preview foundation.

## Current PR scope

- Adds a marketplace adapter port for `listOwnedListings(...)`.
- Adds OLX Partner API read-only advert listing with pagination parameters.
- Adds `MarketplaceImportService.preview(...)` that:
  - verifies the marketplace belongs to the caller workspace;
  - requires a connected marketplace account;
  - resolves an account-scoped access token server-side;
  - creates the authenticated adapter without putting tokens in DTOs/logs/queue payloads;
  - discovers owned adverts only through `GET /adverts`;
  - marks `new`, `already_imported`, and `unsupported` preview rows;
  - reports mapping warnings such as missing price/category/photos.

## Deliberately out of scope for this PR

- Creating Products/Listings from preview rows.
- Seller selection UI.
- Conflict-resolution UI.
- Media copying/persistence strategy.
- Batch resumability and per-advert import execution.
- Real connected-account validation against OLX.

## Safety contract

Preview must remain read-only. Import discovery may call only OLX read endpoints; no publish, update, delete, deactivate, or relist endpoint belongs in preview execution.
