-- Migration 039: reconcile signed legacy view-event totals after migration 038.
--
-- Migration 038 intentionally ignored invalid negative quantities while deriving
-- its gap, but historical reporting sums persisted quantities as stored. Add only
-- the positive correction required for that signed aggregate to reach the latest
-- provider-observed listing counter. Replaying this statement is idempotent.
-- No sales, revenue, messages, or negative correction events are inferred.

WITH signed_views AS (
  SELECT
    l.id AS listing_id,
    COALESCE(SUM(e.quantity) FILTER (WHERE e.event_type = 'view'), 0) AS quantity
  FROM listings l
  LEFT JOIN analytics_events e ON e.listing_id = l.id
  GROUP BY l.id
),
corrections AS (
  SELECT
    p.workspace_id,
    l.id AS listing_id,
    l.marketplace_id,
    GREATEST(COALESCE(l.views, 0) - signed_views.quantity, 0) AS gap,
    COALESCE(l.last_sync_at, l.updated_at, l.published_at, l.created_at, CURRENT_TIMESTAMP) AS occurred_at
  FROM listings l
  JOIN products p ON p.id = l.product_id
  JOIN signed_views ON signed_views.listing_id = l.id
)
INSERT INTO analytics_events (
  workspace_id,
  listing_id,
  marketplace_id,
  event_type,
  quantity,
  amount,
  cost_at_sale,
  currency,
  occurred_at,
  created_at
)
SELECT
  workspace_id,
  listing_id,
  marketplace_id,
  'view',
  LEAST(
    corrections.gap - (chunk.part * 2147483647::BIGINT),
    2147483647::BIGINT
  )::INTEGER,
  NULL,
  NULL,
  NULL,
  occurred_at,
  CURRENT_TIMESTAMP
FROM corrections
CROSS JOIN LATERAL generate_series(
  0,
  ((corrections.gap - 1) / 2147483647)::INTEGER
) AS chunk(part)
WHERE corrections.gap > 0;
