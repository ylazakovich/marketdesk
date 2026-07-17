#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertReleaseAssociation,
  assertExistingProjectIdentity,
  buildReleaseComposeArgs,
  buildReleaseComposeEnvironment,
  createImmutableReleaseContext,
  createReleaseEnvironmentSnapshot,
  deriveReleaseProjectName,
  parseExistingProjectInspection,
  resolveCheckoutRelease,
  resolveCheckoutReleaseTag,
} from './compose-release.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'marketdesk-release-metadata-'));
const gitDir = join(tempRoot, 'git');
const composeDir = join(tempRoot, 'compose');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

try {
  const canonicalArgs = [
    'compose',
    '--project-directory', resolve('.'),
    '--project-name', deriveReleaseProjectName('.'),
    '-f', resolve('docker-compose.yml'),
    'up', '--build', '--detach',
  ];
  assert.deepEqual(buildReleaseComposeArgs(['up']), canonicalArgs);
  assert.deepEqual(buildReleaseComposeArgs(['up', '-d']), canonicalArgs);
  assert.deepEqual(buildReleaseComposeArgs(['up', '--detach']), canonicalArgs);
  assert.deepEqual(
    buildReleaseComposeArgs(
      ['up'],
      '.',
      '/tmp/immutable-release/docker-compose.yml',
      '/tmp/immutable-release/deployment.env',
    ),
    [
      ...canonicalArgs.slice(0, 5),
      '--env-file', '/tmp/immutable-release/deployment.env',
      ...canonicalArgs.slice(5).map((value) => value === resolve('docker-compose.yml')
        ? '/tmp/immutable-release/docker-compose.yml'
        : value),
    ],
  );
  for (const rejected of [
    ['config'], ['build'], ['up', '--build=false'], ['up', '--no-build'],
    ['up', '-f', '/tmp/alternate.yml'], ['up', 'app'],
  ]) {
    assert.throws(() => buildReleaseComposeArgs(rejected), /Usage:/);
  }

  assert.doesNotThrow(() => assertExistingProjectIdentity('hermes-marketdesk', undefined));
  assert.doesNotThrow(() => assertExistingProjectIdentity('hermes-marketdesk', 'hermes-marketdesk'));
  assert.throws(
    () => assertExistingProjectIdentity('hermes-marketdesk', 'redirected-project'),
    /aborting before volume or container mutation/,
  );
  assert.equal(
    parseExistingProjectInspection({ status: 1, stdout: '', stderr: 'Error: No such object: marketdesk-app' }),
    undefined,
  );
  assert.equal(
    parseExistingProjectInspection({ status: 0, stdout: 'hermes-marketdesk\n', stderr: '' }),
    'hermes-marketdesk',
  );
  for (const invalidLabel of ['', '\n', '<no value>\n', 'Invalid Project\n']) {
    assert.throws(
      () => parseExistingProjectInspection({ status: 0, stdout: invalidLabel, stderr: '' }),
      /missing a valid Compose project label/,
    );
  }
  for (const diagnostic of [
    'permission denied',
    'permission denied while checking; No such container: marketdesk-app',
    'No such container: another-app',
  ]) {
    assert.throws(
      () => parseExistingProjectInspection({ status: 1, stdout: '', stderr: diagnostic }),
      /Unable to verify/,
    );
  }

  const composeEnvironment = buildReleaseComposeEnvironment('hermes-marketdesk-v0.10.0', {
    PATH: process.env.PATH,
    COMPOSE_FILE: '/tmp/alternate.yml',
    COMPOSE_PATH_SEPARATOR: ':',
    COMPOSE_PROJECT_NAME: 'alternate',
    COMPOSE_PROFILES: 'alternate',
    COMPOSE_ENV_FILES: '/tmp/alternate.env',
    COMPOSE_DISABLE_ENV_FILE: '1',
    COMPOSE_FUTURE_OVERRIDE: 'must-not-survive',
  });
  assert.equal(composeEnvironment.MARKETDESK_RELEASE_TAG, 'hermes-marketdesk-v0.10.0');
  assert.equal(
    Object.keys(composeEnvironment).some((name) => name.startsWith('COMPOSE_')),
    false,
    'inherited Compose control variables must not override the canonical release deployment',
  );


  mkdirSync(gitDir);
  mkdirSync(composeDir);
  const redirectedDir = join(tempRoot, 'redirected');
  mkdirSync(redirectedDir);
  for (const override of [
    'COMPOSE_PROJECT_NAME=redirected-project',
    'COMPOSE_PROFILES=unexpected',
    'export COMPOSE_FILE=/tmp/alternate.yml',
    '  COMPOSE_FUTURE_CONTROL = enabled',
  ]) {
    writeFileSync(join(redirectedDir, '.env'), `${override}\n`);
    assert.throws(
      () => deriveReleaseProjectName(redirectedDir),
      /forbids COMPOSE_\* control variables in \.env/,
    );
  }
  writeFileSync(join(redirectedDir, '.env'), '# COMPOSE_PROFILES=commented\nAPP_SETTING=ok\n');
  assert.equal(deriveReleaseProjectName(redirectedDir), 'redirected');

  run('git', ['init', '--quiet'], gitDir);
  run('git', ['config', 'user.name', 'MarketDesk CI'], gitDir);
  run('git', ['config', 'user.email', 'ci@example.invalid'], gitDir);
  writeFileSync(join(gitDir, 'artifact.txt'), 'release\n');
  run('git', ['add', 'artifact.txt'], gitDir);
  run('git', ['commit', '--quiet', '-m', 'release'], gitDir);
  run('git', ['tag', 'hermes-marketdesk-v0.10.0'], gitDir);
  const release = resolveCheckoutRelease(gitDir);
  assert.match(release.commit, /^[0-9a-f]{40}$/);
  assert.equal(release.tag, 'hermes-marketdesk-v0.10.0');
  assert.equal(resolveCheckoutReleaseTag(gitDir), 'hermes-marketdesk-v0.10.0');
  run('git', ['tag', 'hermes-marketdesk-v0.10.1'], gitDir);
  assert.throws(
    () => resolveCheckoutReleaseTag(gitDir),
    /requires exactly one valid MarketDesk release tag/,
  );
  run('git', ['tag', '--delete', 'hermes-marketdesk-v0.10.1'], gitDir);
  assert.doesNotThrow(() => assertReleaseAssociation(release, gitDir));
  run('git', ['tag', '--delete', 'hermes-marketdesk-v0.10.0'], gitDir);
  assert.throws(
    () => assertReleaseAssociation(release, gitDir),
    /tag association changed/,
  );
  run('git', ['tag', 'hermes-marketdesk-v0.10.0'], gitDir);

  const immutable = createImmutableReleaseContext(release.commit, gitDir);
  assert.equal(readFileSync(join(immutable.context, 'artifact.txt'), 'utf8'), 'release\n');
  writeFileSync(join(gitDir, '.env'), 'APP_SETTING=release\n', { mode: 0o600 });
  const releaseEnvFile = createReleaseEnvironmentSnapshot(immutable.root, gitDir);
  assert.equal(readFileSync(releaseEnvFile, 'utf8'), 'APP_SETTING=release\n');
  assert.equal(statSync(releaseEnvFile).mode & 0o777, 0o600);
  writeFileSync(join(gitDir, '.env'), 'APP_SETTING=mutated\n', { mode: 0o600 });
  assert.equal(
    readFileSync(releaseEnvFile, 'utf8'),
    'APP_SETTING=release\n',
    'the deployment environment snapshot must not follow checkout mutations',
  );
  rmSync(join(gitDir, '.env'));
  writeFileSync(join(gitDir, 'artifact.txt'), 'dirty release\n');
  assert.equal(
    readFileSync(join(immutable.context, 'artifact.txt'), 'utf8'),
    'release\n',
    'the release context must remain pinned after checkout mutation',
  );
  rmSync(immutable.root, { recursive: true, force: true });
  assert.throws(
    () => resolveCheckoutReleaseTag(gitDir),
    /requires a clean checkout with no tracked or untracked changes/,
  );
  run('git', ['restore', 'artifact.txt'], gitDir);
  writeFileSync(join(gitDir, 'untracked.txt'), 'dirty release\n');
  assert.throws(
    () => resolveCheckoutReleaseTag(gitDir),
    /requires a clean checkout with no tracked or untracked changes/,
  );
  rmSync(join(gitDir, 'untracked.txt'));

  writeFileSync(join(gitDir, 'artifact.txt'), 'after release\n');
  run('git', ['add', 'artifact.txt'], gitDir);
  run('git', ['commit', '--quiet', '-m', 'after release'], gitDir);
  assert.throws(
    () => resolveCheckoutReleaseTag(gitDir),
    /requires HEAD to be checked out at an exact MarketDesk release tag/,
  );
  run('git', ['tag', 'hermes-marketdesk-v01.10.0'], gitDir);
  assert.throws(() => resolveCheckoutReleaseTag(gitDir), /Invalid MarketDesk release tag/);

  const immutableComposeDir = join(tempRoot, 'immutable-compose');
  mkdirSync(join(immutableComposeDir, 'src/backend/persistence/migrations'), { recursive: true });
  copyFileSync(resolve('docker-compose.yml'), join(immutableComposeDir, 'docker-compose.yml'));
  writeFileSync(
    join(composeDir, '.env'),
    [
      'DB_SSL_MODE=disable',
      'DB_PASSWORD=compose-probe-password',
      'JWT_SECRET=compose-probe-jwt-secret',
      'HERMES_API_KEY=compose-probe-hermes-key',
    ].join('\n'),
    { mode: 0o600 },
  );
  const rendered = JSON.parse(run(
    'docker',
    [
      'compose',
      '--project-directory', composeDir,
      '--project-name', 'compose',
      '--env-file', join(composeDir, '.env'),
      '-f', join(immutableComposeDir, 'docker-compose.yml'),
      'config', '--format', 'json',
    ],
    composeDir,
    buildReleaseComposeEnvironment(
      'hermes-marketdesk-v0.10.0',
      { ...process.env, DB_SSL_MODE: 'disable' },
      immutableComposeDir,
      join(composeDir, '.env'),
    ),
  ));
  for (const serviceName of ['app', 'upload-storage-init']) {
    assert.equal(
      rendered.services[serviceName].build.args.MARKETDESK_RELEASE_TAG,
      'hermes-marketdesk-v0.10.0',
      `${serviceName} must receive the exact release tag as a build argument`,
    );
  }
  assert.equal(
    rendered.services.app.environment.MARKETDESK_RELEASE_TAG,
    undefined,
    'runtime environment must not be able to relabel the built artifact',
  );
  assert.equal(rendered.services.app.build.context, immutableComposeDir);
  const migrationMount = rendered.services.postgres.volumes.find(
    (volume) => volume.target === '/docker-entrypoint-initdb.d',
  );
  assert.equal(migrationMount.source, join(composeDir, 'src/backend/persistence/migrations'));
  const uploadMount = rendered.services.app.volumes.find((volume) => volume.target === '/app/uploads');
  assert.equal(uploadMount.source, join(composeDir, 'uploads'));

  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  assert.ok(dockerfile.startsWith('ARG MARKETDESK_RELEASE_TAG=""\n'));
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('# Stage 2: Runtime'));
  const runtimeArg = runtimeStage.indexOf('ARG MARKETDESK_RELEASE_TAG');
  const runtimeFile = runtimeStage.indexOf("RUN printf '%s' \"${MARKETDESK_RELEASE_TAG}\" > /app/.marketdesk-release-tag");
  assert.ok(runtimeArg >= 0, 'runtime stage must consume the release-tag build argument');
  assert.ok(runtimeFile > runtimeArg, 'runtime image must persist the release tag in an artifact file');
  assert.doesNotMatch(runtimeStage, /ENV[^\n]*MARKETDESK_RELEASE_TAG/);
  const exampleEnv = readFileSync(resolve('.env.example'), 'utf8');
  assert.doesNotMatch(exampleEnv, /^MARKETDESK_RELEASE_TAG=/m);

  console.log('Release tag metadata contract verified.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
