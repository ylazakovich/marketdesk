import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      'DATABASE_URL=',
      'DB_HOST=localhost',
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
  assert.equal(internal.services.migrate.environment.DATABASE_URL, '');
  assert.equal(internal.services.migrate.environment.DB_HOST, 'postgres');
  assert.equal(internal.services.migrate.environment.DB_SSL_MODE, 'disable');
  assert.deepEqual(internal.services.migrate.command, ['node', 'dist/backend/migrate.js']);
  assert.equal(internal.services.migrate.environment.MARKETDESK_MIGRATIONS_DIR, '/app/migrations');
  assert.equal(internal.services.migrate.environment.JWT_SECRET, undefined);
  assert.equal(internal.services.migrate.environment.HERMES_API_KEY, undefined);
  assert.equal(internal.services.migrate.environment.MARKETPLACE_CREDENTIALS_KEY, undefined);
  assert.equal(internal.services.migrate.depends_on, undefined);
  assert.equal(internal.services.app.depends_on.migrate.condition, 'service_completed_successfully');
  assert.equal(internal.services.app.depends_on.postgres, undefined);
  assert.equal(internal.services.postgres.ports[0].host_ip, '127.0.0.1');
  assert.equal(internal.services.redis.ports[0].host_ip, '127.0.0.1');

  const external = renderCompose({
    DATABASE_URL: externalUrl,
    DB_SSL_MODE: 'verify-full',
    DB_PASSWORD: '',
  });
  assert.equal(external.services.app.environment.DATABASE_URL, externalUrl);
  assert.equal(external.services.app.environment.DB_SSL_MODE, 'verify-full');
  assert.equal(external.services.app.environment.DB_PASSWORD, 'external-database-unused');
  assert.equal(external.services.migrate.environment.DATABASE_URL, externalUrl);
  assert.equal(external.services.migrate.environment.DB_SSL_MODE, 'verify-full');
  assert.equal(external.services.migrate.environment.DB_PASSWORD, 'external-database-unused');
  assert.equal(
    external.services.postgres.environment.POSTGRES_PASSWORD,
    'external-database-unused',
  );

  const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  assert.match(packageJson.scripts['build:backend'], /npm run build:migrate/);
  assert.match(packageJson.scripts['build:migrate'], /dist\/backend\/migrate\.js/);
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --from=builder --chown=nodejs:nodejs \/app\/dist \.\/dist/);
  assert.match(dockerfile, /COPY --from=builder --chown=nodejs:nodejs \/app\/src\/backend\/persistence\/migrations \.\/migrations/);

  console.log('Docker Compose database + migration gate verified (internal + external).');
} finally {
  rmSync(projectDir, { recursive: true, force: true });
}
