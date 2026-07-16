# OLX publication quota and zero-spend guard

MarketDesk models OLX free-publication allowance separately from `marketplaces.capacity`.
`capacity` describes active advert capacity only; it is not evidence that a new advert is free.

## Safety model

OLX remains authoritative. The Partner API does not currently provide an authoritative fee or
remaining-free-quota preflight, so an operator must record quota evidence for each:

- workspace and connected OLX marketplace account;
- exact OLX subcategory ID used by the adapter;
- quota cycle (`cycleStartedAt` through `cycleEndsAt`).

A quota record includes `publicationLimit`, monotonically increasing `consumed`, `source`,
`confidence`, `verifiedAt`, and `staleAt`. A normal publish or relist is allowed only when the
current cycle exists, confidence is `verified`, evidence is not stale, and `remaining > 0`.
Unknown, estimated, stale, and exhausted quota fails closed.

Relist means creating a new OLX advert. It therefore performs the same quota check and consumes a
publication exactly like publish. Closing, deleting, or selling an advert never restores a unit.
An in-cycle operator update also cannot reduce `consumed`; corrections that would add units require
a new, explicitly recorded cycle or database-level reconciliation.

## Operator API

Both endpoints require the normal authenticated workspace token and never expose OLX credentials.

- `GET /api/marketplaces/:marketplaceId/quotas` lists quota cycles for the connected account.
- `PUT /api/marketplaces/:marketplaceId/quotas` records or refreshes one exact subcategory cycle.

Example body:

```json
{
  "subcategoryId": "2000",
  "cycleStartedAt": "2026-07-01T00:00:00.000Z",
  "cycleEndsAt": "2026-07-31T00:00:00.000Z",
  "publicationLimit": 5,
  "consumed": 2,
  "source": "operator",
  "confidence": "verified",
  "verifiedAt": "2026-07-15T10:00:00.000Z",
  "staleAt": "2026-07-16T10:00:00.000Z"
}
```

`POST /api/listings/:id/publish-preview` returns `quotaDecision` with the exact subcategory,
limit, consumed, remaining, cycle dates, source, confidence, verification/staleness fields, status,
and `allow`/`block` decision. Preview never consumes a unit.

## Explicit override

There is no global bypass. A paid-risk operation requires an authenticated operator to include an
operation-scoped confirmation on that single publish or relist request:

```json
{
  "quotaOverride": {
    "confirmed": true,
    "reason": "Operator accepts the possible OLX publication fee for this advert"
  }
}
```

The reason is mandatory. The operation ledger and activity log record allow, block, and override
decisions. If a known quota row exists, an override still increments `consumed` so later deletion or
sale cannot make the unit reappear.

## Concurrency and operational limitations

Authorization runs in a PostgreSQL transaction. A durable operation ID prevents retry double-count,
and `SELECT ... FOR UPDATE` serializes competing operations for the same subcategory cycle, so only
one operation can consume the final free unit.

Quota is reserved before the publish job is enqueued. This is deliberately conservative: an enqueue
or provider failure does not silently return the unit because MarketDesk cannot prove OLX did not
consume it. Reconcile the cycle through verified operator evidence rather than assuming a failed,
deleted, closed, or sold advert restored quota.

This implementation does not call live OLX, infer quota from active adverts, or mutate deployed data.
Apply `019_olx_publication_quota.sql` through the normal migration runner before enabling this code in
an existing environment.
