#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_TAG_PATTERN = /^hermes-marketdesk-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const RELEASE_CONTEXT_PREFIX = 'marketdesk-release-context-';

function runGit(args, cwd, failureMessage) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

export function resolveCheckoutRelease(cwd = process.cwd()) {
  const commit = runGit(
    ['rev-parse', '--verify', 'HEAD'],
    cwd,
    'Unable to resolve the release commit',
  );
  const tag = runGit(
    ['describe', '--tags', '--exact-match', '--match', 'hermes-marketdesk-v[0-9]*', commit],
    cwd,
    'Release deployment requires HEAD to be checked out at an exact MarketDesk release tag',
  );
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid MarketDesk release tag: ${tag || '(empty)'}`);
  }

  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd, encoding: 'utf8' },
  );
  if (status.status !== 0 || status.stdout !== '') {
    throw new Error('Release deployment requires a clean checkout with no tracked or untracked changes');
  }
  const currentCommit = runGit(
    ['rev-parse', '--verify', 'HEAD'],
    cwd,
    'Unable to revalidate the release commit',
  );
  if (currentCommit !== commit) {
    throw new Error('Release checkout changed while it was being validated');
  }
  return { commit, tag };
}

export function resolveCheckoutReleaseTag(cwd = process.cwd()) {
  return resolveCheckoutRelease(cwd).tag;
}

export function scavengeStaleReleaseContexts(baseDirectory = tmpdir()) {
  let entries;
  try {
    entries = readdirSync(baseDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(RELEASE_CONTEXT_PREFIX)) continue;
    const root = join(baseDirectory, entry.name);
    let ownerPid;
    try {
      ownerPid = Number.parseInt(readFileSync(join(root, 'owner.pid'), 'utf8'), 10);
    } catch {
      ownerPid = Number.NaN;
    }
    let active = false;
    if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        active = true;
      } catch (error) {
        active = error?.code === 'EPERM';
      }
    }
    if (!active) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Another user may own a similarly named private directory; leave it untouched.
      }
    }
  }
}

export function createImmutableReleaseContext(commit, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Release context requires an exact commit SHA');
  }
  scavengeStaleReleaseContexts();
  const root = mkdtempSync(join(tmpdir(), RELEASE_CONTEXT_PREFIX));
  writeFileSync(join(root, 'owner.pid'), `${process.pid}\n`, { mode: 0o600 });
  const context = join(root, 'context');
  const archive = join(root, 'release.tar');
  mkdirSync(context);
  try {
    const gitArchive = spawnSync(
      'git',
      ['archive', '--format=tar', `--output=${archive}`, commit],
      { cwd, encoding: 'utf8' },
    );
    if (gitArchive.status !== 0) throw new Error('Unable to archive the validated release commit');
    const extract = spawnSync('tar', ['-xf', archive, '-C', context], { encoding: 'utf8' });
    if (extract.status !== 0) throw new Error('Unable to extract the immutable release context');
    rmSync(archive, { force: true });
    return { context, root };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function assertNoComposeControls(envFile) {
  const hasOverride = envFile.split(/\r?\n/).some((line) =>
    /^(?:\s*export\s+)?\s*COMPOSE_[A-Z0-9_]+\s*=/.test(line) && !/^\s*#/.test(line),
  );
  if (hasOverride) {
    throw new Error('Release deployment forbids COMPOSE_* control variables in .env');
  }
}

export function createReleaseEnvironmentSnapshot(root, cwd = process.cwd()) {
  let envFile;
  try {
    envFile = readFileSync(resolve(cwd, '.env'), 'utf8');
  } catch {
    throw new Error('Release deployment requires a readable .env file');
  }
  assertNoComposeControls(envFile);
  const snapshot = resolve(root, 'deployment.env');
  writeFileSync(snapshot, envFile, { mode: 0o600 });
  return snapshot;
}

export function deriveReleaseProjectName(cwd = process.cwd()) {
  const projectDirectory = resolve(cwd);
  try {
    const envFile = readFileSync(resolve(projectDirectory, '.env'), 'utf8');
    assertNoComposeControls(envFile);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
    if (code !== 'ENOENT') throw error;
  }

  const projectName = basename(projectDirectory);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    throw new Error(`Checkout directory is not a valid canonical Compose project name: ${projectName}`);
  }
  return projectName;
}

export function assertExistingProjectIdentity(projectName, existingProjectName) {
  if (existingProjectName && existingProjectName !== projectName) {
    throw new Error(
      `Existing MarketDesk project is ${existingProjectName}, but this checkout resolves to ${projectName}; aborting before volume or container mutation`,
    );
  }
}

export function parseExistingProjectInspection(result) {
  if (result.status === 0) {
    const projectName = result.stdout.trim();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
      throw new Error('Existing marketdesk-app is missing a valid Compose project label');
    }
    return projectName;
  }
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const absent = /^(?:(?:Error response from daemon|Error):\s*)?No such (?:object|container):\s*marketdesk-app$/i;
  if (absent.test(diagnostic)) return undefined;
  throw new Error('Unable to verify the existing MarketDesk Compose project identity');
}

export function inspectExistingProjectName(cwd) {
  return parseExistingProjectInspection(spawnSync(
    'docker',
    ['inspect', 'marketdesk-app', '--format', '{{ index .Config.Labels "com.docker.compose.project" }}'],
    { cwd, encoding: 'utf8' },
  ));
}

export function buildReleaseComposeArgs(args, cwd = process.cwd(), composeFile, envFile) {
  const accepted = args.length === 1 && args[0] === 'up'
    || args.length === 2 && args[0] === 'up' && ['-d', '--detach'].includes(args[1]);
  if (!accepted) {
    throw new Error('Usage: npm run compose:release -- up [-d|--detach]');
  }
  const projectDirectory = resolve(cwd);
  return [
    'compose',
    '--project-directory', projectDirectory,
    '--project-name', deriveReleaseProjectName(projectDirectory),
    ...(envFile ? ['--env-file', resolve(envFile)] : []),
    '-f', resolve(composeFile ?? resolve(projectDirectory, 'docker-compose.yml')),
    'up', '--build', '--detach',
  ];
}

export function buildReleaseComposeEnvironment(
  releaseTag,
  baseEnvironment = process.env,
  releaseContext,
  releaseEnvFile,
) {
  const environment = { ...baseEnvironment, MARKETDESK_RELEASE_TAG: releaseTag };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('COMPOSE_')) delete environment[name];
  }
  if (releaseContext) {
    environment.MARKETDESK_BUILD_CONTEXT = releaseContext;
  }
  if (releaseEnvFile) environment.MARKETDESK_ENV_FILE = releaseEnvFile;
  return environment;
}

export function runReleaseCompose(args, cwd = process.cwd()) {
  const release = resolveCheckoutRelease(cwd);
  const projectName = deriveReleaseProjectName(cwd);
  assertExistingProjectIdentity(projectName, inspectExistingProjectName(cwd));
  const immutable = createImmutableReleaseContext(release.commit, cwd);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(immutable.root, { recursive: true, force: true });
  };
  const signalHandlers = new Map();
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    signalHandlers.set(signal, () => {
      cleanup();
      removeSignalHandlers();
      process.kill(process.pid, signal);
    });
  }
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);
  process.once('exit', cleanup);
  try {
    const releaseEnvFile = createReleaseEnvironmentSnapshot(immutable.root, cwd);
    const composeArgs = buildReleaseComposeArgs(
      args,
      cwd,
      resolve(immutable.context, 'docker-compose.yml'),
      releaseEnvFile,
    );
    const result = spawnSync('docker', composeArgs, {
      cwd,
      env: buildReleaseComposeEnvironment(
        release.tag,
        process.env,
        immutable.context,
        releaseEnvFile,
      ),
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    removeSignalHandlers();
    process.removeListener('exit', cleanup);
    cleanup();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  try {
    process.exitCode = runReleaseCompose(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
