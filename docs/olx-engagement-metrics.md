# OLX engagement metrics contract

MarketDesk syncs OLX engagement counters only when the connected Partner API response exposes supported numeric fields.

## Supported mapping

| OLX field | MarketDesk field | Semantics |
| --- | --- | --- |
| `metrics.views` | `listing.views` | Numeric advert view count. |
| `metrics.favorites` | `listing.watchers` | Numeric favourite/watcher count when exposed by OLX. |
| `metrics.messages` | `listing.messages` | Numeric message/lead count when exposed as a counter. Message bodies are never ingested. |

## Unavailable metrics

- Missing, `null`, negative, non-numeric, or schema-changed counter values are treated as unavailable.
- Unavailable values are represented as `null` at the listing API boundary and surfaced through `metricsAvailability` booleans.
- Unavailable values never overwrite previously synced valid counters.
- Analytics and Hermes ranking paths may coalesce unavailable counters to `0` only for aggregate arithmetic; listing DTOs keep the distinction between unavailable and real zero.

## Sync safety

- `lastSyncAt` on a listing is updated after a successful provider read for that listing.
- Authentication, rate-limit, timeout, and provider failures still fail the sync job and preserve prior listing counters.
- Message content is out of scope and must not be requested, stored, logged, or exposed.

## Live validation

Read-only validation against an active OLX advert requires active connected-account credentials and a target advert id. It was not run as part of this code change without an explicit operator-approved target.
