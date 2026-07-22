-- Migration 038: reconcile legacy cumulative listing views into canonical events.
--
-- Listings pre-dating analytics event capture already contain provider-observed
-- cumulative view counters. Seed only the positive gap between that snapshot and
-- canonical view events, so replay and partially populated histories are safe.
-- No sales, revenue, or messages are inferred here.

WITH existing_views AS (
  SELECT
    l.id AS listing_id,
    COALESCE(SUM(GREATEST(e.quantity, 0)) FILTER (WHERE e.event_type = 'view'), 0) AS quantity
  FROM listings l
  LEFT JOIN analytics_events e ON e.listing_id = l.id
  GROUP BY l.id
),
baselines AS (
  SELECT
    p.workspace_id,
    l.id AS listing_id,
    l.marketplace_id,
    GREATEST(COALESCE(l.views, 0) - existing_views.quantity, 0)::INTEGER AS quantity,
    COALESCE(l.last_sync_at, l.updated_at, l.published_at, l.created_at, CURRENT_TIMESTAMP) AS occurred_at
  FROM listings l
  JOIN products p ON p.id = l.product_id
  JOIN existing_views ON existing_views.listing_id = l.id
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
  quantity,
  NULL,
  NULL,
  NULL,
  occurred_at,
  CURRENT_TIMESTAMP
FROM baselines
WHERE quantity > 0;
