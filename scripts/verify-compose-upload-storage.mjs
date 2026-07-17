#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectDir = mkdtempSync(join(tmpdir(), 'marketdesk-compose-uploads-'));
const composeFile = join(projectDir, 'docker-compose.yml');
const uploadTarget = '/app/uploads';
const expectedCommand = [
  'mkdir -p /app/uploads/workspaces',
  'chown -R 1001:1001 /app/uploads',
].join('\n');

function renderCompose() {
  const result = spawnSync(
    'docker',
    ['compose', '--project-directory', projectDir, '-f', composeFile, 'config', '--format', 'json'],
    { encoding: 'utf8', env: { ...process.env, DB_SSL_MODE: 'disable' } },
  );
  if (result.status !== 0) {
    throw new Error('docker compose upload storage configuration probe failed');
  }
  return JSON.parse(result.stdout);
}

function uploadMount(service) {
  return service.volumes.find((volume) => volume.target === uploadTarget);
}

try {
  copyFileSync(resolve('docker-compose.yml'), composeFile);
  writeFileSync(
    join(projectDir, '.env'),
    [
      'DB_SSL_MODE=disable',
      'DB_PASSWORD=compose-probe-password',
      'JWT_SECRET=compose-probe-jwt-secret',
      'HERMES_API_KEY=compose-probe-hermes-key',
    ].join('\n'),
    { mode: 0o600 },
  );

  const config = renderCompose();
  const init = config.services['upload-storage-init'];
  const app = config.services.app;
  assert.ok(init, 'upload-storage-init service must exist');

  assert.equal(init.user, '0:0', 'only the one-shot initializer may run as root');
  assert.equal(app.user, undefined, 'app must inherit the image non-root USER');
  assert.equal(init.image, app.image, 'initializer and app must run the same tagged image');
  assert.deepEqual(init.build, app.build, 'initializer and app must use the same image build');
  assert.deepEqual(init.environment ?? {}, {}, 'initializer must not accept environment-controlled paths');

  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  assert.match(dockerfile, /adduser\s+-S\s+nodejs\s+-u\s+1001\s+-G\s+nodejs/);
  assert.match(dockerfile, /\nUSER nodejs\s*\n/);
  assert.ok(
    dockerfile.indexOf('USER nodejs') < dockerfile.indexOf('CMD ["node", "dist/backend/main.js"]'),
    'the long-running command must execute after USER nodejs',
  );

  const initMount = uploadMount(init);
  const appMount = uploadMount(app);
  assert.ok(initMount && appMount, 'both services must mount upload storage at /app/uploads');
  assert.equal(initMount.type, 'bind');
  assert.equal(appMount.type, 'bind');
  assert.equal(initMount.source, appMount.source, 'initializer and app must share the same bind source');
  assert.equal(app.environment.UPLOAD_DIR, uploadTarget);

  assert.equal(app.depends_on['upload-storage-init'].condition, 'service_completed_successfully');
  assert.deepEqual(init.command.slice(0, 2), ['sh', '-ceu']);
  const command = init.command[2].trim();
  assert.equal(command, expectedCommand, 'initializer command must stay on the reviewed fixed-path allowlist');
  assert.doesNotMatch(command, /\$|\benv\b|chmod|rm\s|\/app\/(?!uploads\b)/);
  assert.equal(init.network_mode, 'none', 'initializer must not have network access');
  assert.equal(init.restart, 'no');

  console.log('Docker Compose upload storage initialization verified.');
} finally {
  rmSync(projectDir, { recursive: true, force: true });
}
