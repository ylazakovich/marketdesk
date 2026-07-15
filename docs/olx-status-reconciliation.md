# OLX remote status reconciliation

This document records the OLX Partner API advert lifecycle statuses that MarketDesk currently understands during marketplace sync.

## Mapping

| OLX remote status | Local handling |
| --- | --- |
| `active`, `activated`, `live`, `published` | Reconcile listing to `live` when the local domain transition allows it. |
| `new`, `moderation`, `pending`, `limited` | Treat as transient/observed. Keep the local listing status unchanged and store a sync note. |
| `expired`, `removed`, `deactivated`, `deleted`, `closed` | Reconcile listing to `expired` when the local domain transition allows it. |
| `rejected`, `blocked`, `error` | Reconcile listing to `error` with an actionable sync message. |
| remote `404` / missing advert | Treat as a missing remote advert and reconcile to `expired`; auth, rate-limit, timeout, and provider failures still fail the sync job. |
| unknown status | Keep the local listing status unchanged and store the unknown remote status in the sync note. |

## Safety rules

- Unknown and transient statuses are non-destructive.
- Reconciliation emits `listing.remote_status_reconciled` only when the local listing status actually changes.
- If the domain rejects a transition, the sync worker records an actionable sync note instead of bypassing domain invariants.
- Engagement counters and `lastSyncAt` are still updated for matched listings during successful syncs.
