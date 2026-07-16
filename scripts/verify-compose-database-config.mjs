import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectDir = mkdtempSync(join(tmpdir(), 'marketdesk-compose-db-'));
const composeFile = join(projectDir, 'docker-compose.yml');
const externalUrl = 'postgresql://external-user:probe-password@managed-db.example.com:5432/marketdesk';

function renderCompose(overrides) {
  const result = spawnSync(
    'docker',
    ['compose', '--project-directory', projectDir, '-f', composeFile, 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: { ...process.env, ...overrides },
    },
  );
  if (result.status !== 0) {
    throw new Error('docker compose database configuration probe failed');
  }
  return JSON.parse(result.stdout);
}

try {
  copyFileSync(resolve('docker-compose.yml'), composeFile);
  writeFileSync(
    join(projectDir, '.env'),
    [
      'DB_SSL_MODE=disable',
      'DB_PASSWORD=internal-probe-password',
      'JWT_SECRET=compose-probe-jwt-secret',
      'HERMES_API_KEY=compose-probe-hermes-key',
    ].join('\n'),
    { mode: 0o600 },
  );

  const internal = renderCompose({ DATABASE_URL: '', DB_SSL_MODE: 'disable' });
  assert.equal(internal.services.app.environment.DATABASE_URL, '');
  assert.equal(internal.services.app.environment.DB_HOST, 'postgres');
  assert.equal(internal.services.app.environment.DB_SSL_MODE, 'disable');

  const external = renderCompose({
    DATABASE_URL: externalUrl,
    DB_SSL_MODE: 'verify-full',
  });
  assert.equal(external.services.app.environment.DATABASE_URL, externalUrl);
  assert.equal(external.services.app.environment.DB_SSL_MODE, 'verify-full');

  console.log('Docker Compose database configuration verified (internal + external).');
} finally {
  rmSync(projectDir, { recursive: true, force: true });
}
