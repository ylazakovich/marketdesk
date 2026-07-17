# Installed release version

MarketDesk displays the version embedded in the running artifact. It never queries GitHub at runtime and does not expose a commit SHA, branch, or dirty state.

## Release deployment

Check out the exact release tag and run Compose through the fail-closed wrapper:

```bash
git checkout hermes-marketdesk-v0.10.0
npm run compose:release -- up -d
```

The wrapper:

1. resolves `HEAD` with `git describe --tags --exact-match`;
2. requires a clean checkout with no tracked or untracked changes;
3. accepts only `hermes-marketdesk-vX.Y.Z`;
4. permits only detached Compose `up`, pins the repository Compose file/project directory and directory-derived project name, verifies any existing `marketdesk-app` project label, and always adds `--build`;
5. exports that exact value as `MARKETDESK_RELEASE_TAG` only for the Compose subprocess;
6. archives the validated commit and uses that immutable archive for the Compose file, Docker build context, and Dockerfile;
7. snapshots `.env` with mode `0600` and uses the snapshot explicitly for Compose interpolation and the app environment;
8. removes the private temporary context on normal completion and handled termination signals, while the next release run scavenges orphaned contexts whose owner process no longer exists;
9. lets Compose pass the tag as a Docker build argument;
10. stores it in the immutable `/app/.marketdesk-release-tag` image file.

The command exits before invoking Compose when `HEAD` is not an exact valid release tag, the checkout is dirty, `.env` contains any `COMPOSE_*` control variable, or an existing `marketdesk-app` belongs to a different directory-derived project. The application image is built only from the validated commit archive; the original project directory remains authoritative for deployment-local bind mounts, uploads, and existing Compose resources. These safeguards prevent a release from silently changing services, switching PostgreSQL/Redis volumes, or incorporating a checkout mutation into the labeled image after validation. The application reads only the image file; runtime environment values cannot relabel an old image as a newer release. Do not manually persist a release tag in `.env`.

Normal local builds leave `MARKETDESK_RELEASE_TAG` empty and honestly report `Development`. Malformed non-empty metadata reports `Version unavailable` rather than guessing.

## Runtime verification

For `hermes-marketdesk-v0.10.0`, both public runtime contracts must report `v0.10.0`:

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
