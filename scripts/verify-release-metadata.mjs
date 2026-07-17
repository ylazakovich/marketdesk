#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertExistingProjectIdentity,
  buildReleaseComposeArgs,
  buildReleaseComposeEnvironment,
  deriveReleaseProjectName,
  parseExistingProjectInspection,
  resolveCheckoutReleaseTag,
} from './compose-release.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'marketdesk-release-metadata-'));
const gitDir = join(tempRoot, 'git');
const composeDir = join(tempRoot, 'compose');

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
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
  assert.throws(() => buildReleaseComposeArgs(['config']), /Usage:/);
  assert.throws(() => buildReleaseComposeArgs(['build']), /Usage:/);
  assert.throws(() => buildReleaseComposeArgs(['up', '--build=false']), /Usage:/);
  assert.throws(() => buildReleaseComposeArgs(['up', '--no-build']), /Usage:/);
  assert.throws(() => buildReleaseComposeArgs(['up', '-f', '/tmp/alternate.yml']), /Usage:/);
  assert.throws(() => buildReleaseComposeArgs(['up', 'app']), /Usage:/);
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
  assert.throws(
    () => parseExistingProjectInspection({ status: 1, stdout: '', stderr: 'permission denied' }),
    /Unable to verify/,
  );

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
  writeFileSync(join(redirectedDir, '.env'), 'COMPOSE_PROJECT_NAME=redirected-project\n');
  assert.throws(
    () => deriveReleaseProjectName(redirectedDir),
    /forbids COMPOSE_PROJECT_NAME in \.env/,
  );
  run('git', ['init', '--quiet'], gitDir);
  run('git', ['config', 'user.name', 'MarketDesk CI'], gitDir);
  run('git', ['config', 'user.email', 'ci@example.invalid'], gitDir);
  writeFileSync(join(gitDir, 'artifact.txt'), 'release\n');
  run('git', ['add', 'artifact.txt'], gitDir);
  run('git', ['commit', '--quiet', '-m', 'release'], gitDir);
  run('git', ['tag', 'hermes-marketdesk-v0.10.0'], gitDir);
  assert.equal(resolveCheckoutReleaseTag(gitDir), 'hermes-marketdesk-v0.10.0');

  writeFileSync(join(gitDir, 'artifact.txt'), 'dirty release\n');
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

  copyFileSync(resolve('docker-compose.yml'), join(composeDir, 'docker-compose.yml'));
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
  const rendered = JSON.parse(
    run(
      'docker',
      ['compose', '--project-directory', composeDir, '-f', join(composeDir, 'docker-compose.yml'), 'config', '--format', 'json'],
      composeDir,
      { ...process.env, MARKETDESK_RELEASE_TAG: 'hermes-marketdesk-v0.10.0', DB_SSL_MODE: 'disable' },
    ),
  );
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
