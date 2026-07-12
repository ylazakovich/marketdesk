-- Migration 001: Workspaces (multi-tenancy root) and Users (v1 auth)
-- Authoritative source: ARCHITECTURE.md §7
-- NOTE: `users` is a pragmatic v1 auth addition to support JWT auth
--       (the request pipeline references user context). Full RBAC is Phase 2.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces (multi-tenancy root)
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(3) DEFAULT 'PLN',
  timezone VARCHAR(100) DEFAULT 'Europe/Warsaw',
  autonomy_level VARCHAR(50) DEFAULT 'suggest_only',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users (v1 auth addition; full RBAC is Phase 2)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
