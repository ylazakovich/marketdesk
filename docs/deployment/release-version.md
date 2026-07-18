# Installed release version

MarketDesk displays the version embedded in the running artifact. It never queries GitHub at runtime and does not expose a commit SHA, branch, or dirty state.

## Release deployment

Create and verify a fresh live PostgreSQL, Redis, and uploads backup before every
release. Keep it owner-private and record checksums/restore-list validation. Then
check out the exact release tag and run Compose through the fail-closed wrapper:

```bash
git checkout marketdesk-v0.10.0
npm run compose:release -- up -d
```

The wrapper:

1. resolves `HEAD` and enumerates canonical release tags pointing exactly at that commit;
2. requires a clean checkout with no tracked or untracked changes;
3. accepts only `marketdesk-vX.Y.Z`;
4. permits only detached Compose `up`, pins the repository Compose file/project directory and directory-derived project name, verifies any existing `marketdesk-app` project label, and always adds `--build`;
5. exports that exact value as `MARKETDESK_RELEASE_TAG` only for the Compose subprocess;
6. archives the validated commit and uses that immutable archive for the Compose file, Docker build context, and Dockerfile;
7. snapshots `.env` with mode `0600` and uses the snapshot explicitly for Compose interpolation and the app environment;
8. atomically creates a stable project lock outside `TMPDIR`; it removes the lock only after Compose succeeds or before Compose starts, and retains the private context after every post-spawn error, signal, or wrapper termination;
9. builds an executable migration bundle into the exact application image and runs its one-shot `migrate` service against the selected database with bounded connection retry;
10. allows the new application service to start only after `migrate` exits successfully, while migrations remain serialized by the PostgreSQL advisory lock;
11. lets Compose pass the tag as a Docker build argument;
12. stores it in the immutable `/app/.marketdesk-release-tag` image file.

When `DATABASE_URL` is non-empty in the snapshotted environment, the wrapper
scales the bundled PostgreSQL service to zero. Internal deployments start the
bundled service and the migration retry absorbs its startup interval. The
bundled PostgreSQL service initializes only the database and role; it does not
mount SQL into `/docker-entrypoint-initdb.d`. Fresh and existing databases are
therefore migrated only by the immutable bundle in the one-shot release image.

The release environment snapshot must contain final literal values. Do not use `$VAR` or `${VAR}`
references in `.env`: the wrapper rejects them before choosing internal versus external PostgreSQL or
starting Compose, so ambient shell state cannot redirect migrations or change TLS policy.

The command exits before invoking Compose when `HEAD` is not an exact valid release tag, the checkout is dirty, `.env` contains any `COMPOSE_*` control variable, or an existing `marketdesk-app` belongs to a different directory-derived project. The application image is built only from the validated commit archive; the original project directory remains authoritative for deployment-local bind mounts, uploads, and existing Compose resources. These safeguards prevent a release from silently changing services, switching PostgreSQL/Redis volumes, or incorporating a checkout mutation into the labeled image after validation. The migration service receives only the database subset interpolated from the same snapshot used by the application, and both services use the same image. The application reads only the image file; runtime environment values cannot relabel an old image as a newer release. Do not manually persist a release tag in `.env`.

A migration failure makes Compose and the release command exit non-zero. The new application service is not started because its `migrate` dependency did not complete successfully. This is an in-place, maintenance-window deployment rather than blue/green: Compose may stop or replace the previous app container before the migration result is known, so a failed migration may leave the service unavailable until forward recovery. Do not begin without the verified backup and an accepted maintenance window. An interrupted or failed post-spawn deployment deliberately leaves `/tmp/marketdesk-release.lock` in place, including its mode-`0600` environment snapshot. The fixed directory directly under sticky `/tmp` is shared by every Unix user and checkout on the Docker host, serializing all mutations of the globally named `marketdesk-*` containers regardless of UID, checkout basename, or `TMPDIR`. Inspect the one-shot migration logs and verify that no Docker Compose/build process remains before the lock owner or root manually removes the directory and retries; never automate stale-lock removal.

Normal local builds leave `MARKETDESK_RELEASE_TAG` empty and honestly report `Development`. Malformed non-empty metadata reports `Version unavailable` rather than guessing.

## Runtime verification

For `marketdesk-v0.10.0`, both public runtime contracts must report `v0.10.0`:

```bash
curl -fsS http://127.0.0.1:3000/api/application-info
curl -fsS http://127.0.0.1:3000/health
```

Expected fields:

```json
{"success":true,"data":{"version":"v0.10.0"}}
```

```json
{"status":"ok","version":"v0.10.0"}
```

The health response contains additional operational fields. Neither response may contain Git commit, branch, or dirty-worktree information.

The same version appears in **Settings → About → Application version**.

## Contract checks

```bash
npm run verify:release-metadata
npm test -- --runInBand src/backend/config/applicationVersion.test.ts src/backend/presentation/__tests__/api.integration.test.ts src/frontend/pages/SettingsPage.test.tsx
```

The metadata verifier uses temporary Git repositories to prove exact-tag acceptance and untagged/malformed-tag rejection, then checks the rendered Compose build arguments and Docker runtime environment wiring.
