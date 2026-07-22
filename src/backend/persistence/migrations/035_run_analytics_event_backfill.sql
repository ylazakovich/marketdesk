-- Migration 035: execute the online backfill as a top-level CALL.
-- The procedure commits every bounded batch and is safe to rerun after interruption.

CALL marketdesk_backfill_analytics_event_identity(1000);
