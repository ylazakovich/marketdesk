-- Migration 007: Persist configurable Hermes guardrails on workspaces.
-- Authoritative source: ARCHITECTURE_AMENDMENTS FIX #5.
-- Previously guardrails lived only in the domain (Workspace entity) and were
-- never persisted (WorkspaceRepository dropped them on save). This adds the
-- backing column so per-workspace guardrails survive a round-trip. Nullable with
-- no default: a NULL column means "use DEFAULT_HERMES_GUARDRAILS" at the mapper.
-- Idempotent so it is safe to re-run.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS guardrails JSONB;
