# OLX engagement metrics contract

MarketDesk syncs OLX engagement counters only when the connected Partner API response exposes supported numeric fields.

## Supported mapping

| OLX field | MarketDesk field | Semantics |
| --- | --- | --- |
| `metrics.views`, `statistics.views`, `statistics.advert_views`, compatible `stats/counters` view aliases | `listing.views` | Numeric advert view count. |
| `metrics.favorites`, `metrics.favourites`, `metrics.watchers`, compatible favourite/watcher aliases | `listing.watchers` | Numeric favourite/watcher count when exposed by OLX. |
| `metrics.messages`, `statistics.messages`, `message_count`, `messages_count` | `listing.messages` | Numeric buyer-message count only when OLX exposes an explicit message counter. Message bodies are never ingested. |

`phone_views`, phone/contact reveals, and generic lead counters are not buyer-message counters and must not populate `listing.messages`.

## Unavailable metrics

- Missing, `null`, negative, non-numeric, or schema-changed counter values are treated as unavailable.
- Unavailable values are represented as `null` at the listing API boundary and surfaced through `metricsAvailability` booleans.
- A successful OLX read that exposes no explicit message counter marks messages unavailable and clears legacy values previously derived from `phone_views`.
- A failed/partial statistics read preserves the last valid message count and exposes a stale-metric sync note.
- Analytics and Hermes ranking paths may coalesce unavailable counters to `0` only for aggregate arithmetic; listing DTOs keep the distinction between unavailable and real zero.

## Sync safety

- `lastSyncAt` on a listing is updated after a successful provider read for that listing.
- Authentication, rate-limit, timeout, and provider failures still fail the sync job and preserve prior listing counters.
- Message content is out of scope and must not be requested, stored, logged, or exposed.

## Live validation

Read-only validation on 2026-07-17 against approved active advert `1085783130` found:

- `GET /api/partner/adverts/1085783130` (Partner API `Version: 2.0`) exposed no message/chat aggregate field.
- `GET /api/partner/adverts/1085783130/statistics` returned `advert_views = 2`, `users_observing = 0`, and `phone_views = 0`; it exposed no buyer-message aggregate even though the OLX UI displayed one message.
- MarketDesk had persisted `messages = 0` with `metricsAvailability.messages = true`; this was the semantic mismatch corrected here.
