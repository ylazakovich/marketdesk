# Runbook

## Local checks

Use targeted tests first, then broader checks when code paths span frontend/backend:

- `npm test -- --runInBand <test files>`
- `npm run type-check`
- `npm run build`
- `git diff --check`

## Live delivery

Before updating, restarting, rebuilding, stopping, or migrating the live Docker app with real data:

1. Inspect current status read-only.
2. Back up PostgreSQL, Redis, and `uploads/` without leaking `.env` or secrets.
3. Verify backup archive members and checksum.
4. Only then pull/reset/build/restart/apply migrations.
5. Verify Compose health, `/health`, `/ready`, logs, and public HTTPS routing.

Live marketplace side effects remain behind explicit publish/sync confirmations and configured live gates.
