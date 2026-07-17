# Upload storage initialization and recovery

MarketDesk stores both current workspace-scoped product images and older upload layouts in the host bind mount `./uploads`.

## Compose startup contract

`docker compose up` builds the `upload-storage-init` and `app` services from the same application image. Startup is ordered as follows:

1. The one-shot `upload-storage-init` service runs as `0:0`.
2. It creates only `/app/uploads/workspaces` and recursively assigns `/app/uploads` to UID/GID `1001:1001`.
3. It exits successfully without deleting or replacing existing files, including legacy directories.
4. Compose starts `app` only after the initializer completes successfully.
5. The long-running app inherits `USER nodejs` (UID/GID `1001:1001`) from the Dockerfile. Before opening its HTTP port, it creates and deletes a private probe file. Startup fails with `Upload storage is not writable` if that operation is denied.

The init target is intentionally fixed at `/app/uploads`; it cannot be redirected through an environment variable. Do not replace ownership with `chmod 777`.

On a normal Linux Docker host, `./uploads` and its existing descendants are expected to have numeric ownership `1001:1001`. Rootless Docker or user-namespace remapping may show a translated host ID; `id` and a write check inside the app container are authoritative.

```bash
stat -c '%n uid=%u gid=%g mode=%a' uploads uploads/workspaces
docker compose run --rm --no-deps app sh -ceu '
  test "$(id -u)" = 1001
  test "$(id -g)" = 1001
  test -w /app/uploads
  test -d /app/uploads/workspaces
'
```

`docker compose run` executes the image's normal non-root user. Do not add `--user 0` to the app check.

## Permission recovery

Treat an existing upload tree as live data. Back it up and verify the archive before changing ownership:

```bash
tar -C . -czf "${HOME}/marketdesk-uploads-$(date -u +%Y%m%dT%H%M%SZ).tgz" uploads
tar -tzf "$(find "${HOME}" -maxdepth 1 -name 'marketdesk-uploads-*.tgz' -print | sort | tail -1)" >/dev/null
```

Then rerun the reviewed initializer and recreate the app only after it succeeds:

```bash
docker compose run --rm --no-deps upload-storage-init
docker compose up -d app
docker compose logs --since=5m app | grep -E 'Upload storage writable|Upload storage is not writable'
```

The initializer uses `mkdir -p` and `chown`, not deletion, so workspace-scoped files under `uploads/workspaces/` and legacy directories are preserved. If initialization fails, inspect host mount type/ownership and free disk space; do not bypass the app's startup check.

## Real upload/read/restart/delete verification

This probe uses an already-issued short-lived MarketDesk bearer token and a local valid JPEG/PNG/WebP. It embeds no credentials. Keep the token in the environment and do not enable shell tracing.

```bash
export MARKETDESK_BASE_URL='http://127.0.0.1:3000'
export MARKETDESK_TOKEN='set-a-short-lived-token-outside-git'
export PROBE_IMAGE='/absolute/path/to/disposable-valid-image.jpg'

UPLOAD_RESPONSE=$(curl -fsS \
  -H "Authorization: Bearer ${MARKETDESK_TOKEN}" \
  -H 'Content-Type: image/jpeg' \
  --data-binary "@${PROBE_IMAGE}" \
  "${MARKETDESK_BASE_URL}/api/uploads/images")
IMAGE_ID=$(printf '%s' "${UPLOAD_RESPONSE}" | jq -er '.data.id')
IMAGE_URL=$(printf '%s' "${UPLOAD_RESPONSE}" | jq -er '.data.url')

curl -fsS "${MARKETDESK_BASE_URL}${IMAGE_URL}" -o /tmp/marketdesk-upload-probe-read.jpg
test -s /tmp/marketdesk-upload-probe-read.jpg

docker compose restart app
curl --retry 20 --retry-connrefused --retry-delay 1 -fsS \
  "${MARKETDESK_BASE_URL}/ready" >/dev/null
curl -fsS "${MARKETDESK_BASE_URL}${IMAGE_URL}" -o /tmp/marketdesk-upload-probe-after-restart.jpg
test -s /tmp/marketdesk-upload-probe-after-restart.jpg

curl -fsS -X DELETE \
  -H "Authorization: Bearer ${MARKETDESK_TOKEN}" \
  "${MARKETDESK_BASE_URL}/api/uploads/images/${IMAGE_ID}"
! curl -fsS "${MARKETDESK_BASE_URL}${IMAGE_URL}" -o /dev/null
rm -f /tmp/marketdesk-upload-probe-read.jpg /tmp/marketdesk-upload-probe-after-restart.jpg
unset MARKETDESK_TOKEN UPLOAD_RESPONSE IMAGE_ID IMAGE_URL
```

Use a matching `Content-Type` when `PROBE_IMAGE` is PNG or WebP. The final failed public read is expected and proves API deletion removed the object. This scenario does not require or perform a database migration.

Run the static Compose safety regression with:

```bash
npm run verify:compose-uploads
```
