#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  console.log('Release process lifecycle verification skipped on Windows.');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'marketdesk-release-process-'));
const repoName = `release-probe-${process.pid}-${randomBytes(6).toString('hex')}`;
const competingRepoName = `release-competitor-${process.pid}-${randomBytes(6).toString('hex')}`;
const lifecycleToken = randomBytes(16).toString('hex');
const repo = join(root, repoName);
const competingRepo = join(root, competingRepoName);
const fakeBin = join(root, 'bin');
const runtime = join(root, 'runtime');
const alternateRuntime = join(root, 'alternate-runtime');
const lockRoot = '/tmp/marketdesk-release.lock';
const contextRoot = join(lockRoot, 'deployment');
const activeGroups = new Set();

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function processGroupIsAlive(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitUntil(predicate, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(message);
}

function waitForExit(child, timeoutMs = 8000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Child process did not exit in time')), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function spawnWrapper(
  pidFile,
  mode = 'wait',
  temporaryDirectory = runtime,
  checkout = repo,
) {
  const moduleUrl = pathToFileURL(resolve('scripts/compose-release.mjs')).href;
  const code = `import { runReleaseCompose } from ${JSON.stringify(moduleUrl)}; process.exitCode = await runReleaseCompose(['up'], process.cwd());`;
  return spawn(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: checkout,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      TMPDIR: temporaryDirectory,
      FAKE_DOCKER_PID_FILE: pidFile,
      FAKE_DOCKER_MODE: mode,
    },
    stdio: 'ignore',
  });
}

function initializeReleaseRepo(checkout) {
  mkdirSync(checkout);
  writeFileSync(join(checkout, '.gitignore'), '.env\n');
  writeFileSync(join(checkout, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(checkout, 'Dockerfile'), 'FROM scratch\n');
  run('git', ['init', '--quiet'], checkout);
  run('git', ['config', 'user.name', 'MarketDesk CI'], checkout);
  run('git', ['config', 'user.email', 'ci@example.invalid'], checkout);
  run('git', ['add', '.gitignore', 'docker-compose.yml', 'Dockerfile'], checkout);
  run('git', ['commit', '--quiet', '-m', 'release'], checkout);
  run('git', ['tag', 'hermes-marketdesk-v1.2.3'], checkout);
  writeFileSync(
    join(checkout, '.env'),
    `DB_SSL_MODE=disable\nLIFECYCLE_TOKEN=${lifecycleToken}\n`,
    { mode: 0o600 },
  );
}

function readGroup(pidFile) {
  const [, groupLine] = readFileSync(pidFile, 'utf8').trim().split(/\r?\n/);
  const groupId = Number.parseInt(groupLine, 10);
  activeGroups.add(groupId);
  return groupId;
}

async function stopGroup(groupId, signal = 'SIGTERM') {
  process.kill(-groupId, signal);
  await waitUntil(() => !processGroupIsAlive(groupId), `process group ${groupId} did not exit`);
  activeGroups.delete(groupId);
}

function ownsTestLock() {
  const snapshot = join(contextRoot, 'deployment.env');
  return existsSync(snapshot)
    && readFileSync(snapshot, 'utf8').includes(`LIFECYCLE_TOKEN=${lifecycleToken}\n`);
}

function removeOwnLock() {
  if (ownsTestLock()) rmSync(lockRoot, { recursive: true, force: true });
}

try {
  mkdirSync(fakeBin);
  mkdirSync(runtime);
  mkdirSync(alternateRuntime);
  writeFileSync(
    join(fakeBin, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "inspect" ]]; then
  echo "Error: No such object: marketdesk-app" >&2
  exit 1
fi
exec 9>&- 2>/dev/null || true
pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
printf '%s\\n%s\\n' "$$" "$pgid" > "$FAKE_DOCKER_PID_FILE"
if [[ "\${FAKE_DOCKER_MODE:-wait}" == "exit" ]]; then
  exit 0
fi
trap 'exit 0' TERM INT HUP
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
  initializeReleaseRepo(repo);
  initializeReleaseRepo(competingRepo);

  // Different checkout identities target the same globally named MarketDesk containers.
  const firstCheckoutPidFile = join(root, 'first-checkout.pid');
  const competingPidFile = join(root, 'competing-checkout.pid');
  const firstCheckout = spawnWrapper(firstCheckoutPidFile);
  const firstCheckoutExit = waitForExit(firstCheckout);
  await waitUntil(() => existsSync(firstCheckoutPidFile), 'first checkout did not reach Compose');
  const firstCheckoutGroup = readGroup(firstCheckoutPidFile);
  const competitor = spawnWrapper(competingPidFile, 'wait', alternateRuntime, competingRepo);
  const competitorOutcome = await waitForExit(competitor);
  assert.equal(competitorOutcome.code, 1, 'different checkout identities must share one release lock');
  assert.equal(existsSync(competingPidFile), false, 'the competing checkout must not reach Compose');
  await stopGroup(firstCheckoutGroup);
  assert.equal((await firstCheckoutExit).code, 0);
  assert.equal(existsSync(lockRoot), false, 'successful first checkout must clean the global lock');

  // A handled signal is not success even when Compose exits zero.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const signalPidFile = join(root, `${signal.toLowerCase()}-child.pid`);
    const signalledWrapper = spawnWrapper(signalPidFile);
    const signalledExit = waitForExit(signalledWrapper);
    await waitUntil(() => existsSync(signalPidFile), `${signal} fake Compose process did not start`);
    const signalGroupId = readGroup(signalPidFile);
    signalledWrapper.kill(signal);
    const signalOutcome = await signalledExit;
    assert.equal(
      signalOutcome.code,
      { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal],
      `${signal} must not be reported as a successful deployment`,
    );
    await waitUntil(() => !processGroupIsAlive(signalGroupId), `${signal} process group did not exit`);
    activeGroups.delete(signalGroupId);
    assert.equal(existsSync(contextRoot), true, `${signal} must retain the fail-closed context`);
    removeOwnLock();
  }

  // SIGKILL preserves the active context, and the lock stays fail-closed after consumers exit.
  const childPidFile = join(root, 'compose-child.pid');
  const retryPidFile = join(root, 'retry-child.pid');
  const wrapper = spawnWrapper(childPidFile);
  const wrapperExit = waitForExit(wrapper);
  await waitUntil(() => existsSync(childPidFile), 'Fake Compose process did not start');
  const processGroupId = readGroup(childPidFile);
  assert.equal(existsSync(join(contextRoot, 'deployment.env')), true);

  wrapper.kill('SIGKILL');
  await wrapperExit;
  assert.equal(processGroupIsAlive(processGroupId), true, 'Compose must outlive a killed wrapper');
  assert.equal(existsSync(contextRoot), true, 'active Compose must retain its immutable context');

  const retry = spawnWrapper(retryPidFile, 'wait', alternateRuntime, competingRepo);
  const retryOutcome = await waitForExit(retry);
  assert.equal(retryOutcome.code, 1, 'retry must fail while the first Compose group is active');
  assert.equal(existsSync(retryPidFile), false, 'blocked retry must not launch another Compose process');

  await stopGroup(processGroupId);
  const blockedAfterExit = spawnWrapper(retryPidFile, 'exit', alternateRuntime, competingRepo);
  const blockedAfterExitOutcome = await waitForExit(blockedAfterExit);
  assert.equal(blockedAfterExitOutcome.code, 1, 'failed deployment lock must remain after consumers exit');
  assert.equal(existsSync(retryPidFile), false);

  removeOwnLock();
  const recovery = spawnWrapper(retryPidFile, 'exit');
  const recoveryOutcome = await waitForExit(recovery);
  assert.equal(recoveryOutcome.code, 0, 'explicit recovery must permit the next successful release');
  assert.equal(existsSync(lockRoot), false, 'successful release must clean its lock and context');

  console.log('Release process lock and interruption lifecycle verified.');
} finally {
  for (const groupId of activeGroups) {
    if (!processGroupIsAlive(groupId)) continue;
    try {
      process.kill(-groupId, 'SIGKILL');
    } catch {
      // Best-effort cleanup for a failed probe.
    }
  }
  removeOwnLock();
  rmSync(root, { recursive: true, force: true });
}
