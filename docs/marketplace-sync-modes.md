# Marketplace sync mode contract

MarketDesk supports three user-facing marketplace sync modes. Backend behaviour is intentionally conservative so the UI never promises provider behaviour that is not implemented.

## `manual`

- No background schedule is created.
- Sync runs only from an explicit user/system action, such as `POST /api/marketplaces/:id/sync`.
- Switching to `manual` removes any existing hourly repeatable schedule for the marketplace.

## `hourly`

- Connected marketplaces get exactly one deterministic repeatable Bull job.
- Job id: `sync-marketplace:<marketplaceId>:hourly`.
- Interval: one hour.
- The repeatable job payload is workspace/marketplace scoped and token-free: marketplace key/id only, with listing ids resolved at execution time.
- Reconciliation is idempotent across restarts because Bull repeatable jobs are keyed by the deterministic job id.
- Disconnecting a marketplace or switching away from `hourly` removes the repeatable schedule.

## `realtime`

- Disabled for OLX until verified OLX webhooks are available.
- Selecting `realtime` is rejected at the backend boundary and removes any existing hourly schedule first.
- This prevents an unverified pseudo-real-time polling loop from creating provider sync storms.

## Operational safety

- Sync jobs use the existing queue retry/backoff behaviour and marketplace sync bookkeeping.
- Provider outages increment marketplace error counters through the sync handler.
- Manual disconnect/sync-mode changes always reconcile the schedule before the marketplace update response is returned.
