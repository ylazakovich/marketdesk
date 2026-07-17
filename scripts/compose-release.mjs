#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';

const RELEASE_TAG_PATTERN = /^hermes-marketdesk-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const RELEASE_CONTEXT_PREFIX = 'marketdesk-release-context-';


function runGit(args, cwd, failureMessage) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

function canonicalReleaseTags(commit, cwd) {
  return runGit(
    ['tag', '--points-at', commit],
    cwd,
    'Unable to resolve release tags for the exact commit',
  ).split(/\r?\n/).filter((tag) => RELEASE_TAG_PATTERN.test(tag));
}

export function resolveCheckoutRelease(cwd = process.cwd()) {
  const commit = runGit(
    ['rev-parse', '--verify', 'HEAD'],
    cwd,
    'Unable to resolve the release commit',
  );
  const allTags = runGit(
    ['tag', '--points-at', commit],
    cwd,
    'Unable to resolve release tags for the exact commit',
  ).split(/\r?\n/).filter(Boolean);
  const releaseTags = allTags.filter((tag) => RELEASE_TAG_PATTERN.test(tag));
  if (releaseTags.length === 0) {
    const marketDeskTag = allTags.find((tag) => tag.startsWith('hermes-marketdesk-v'));
    if (marketDeskTag) throw new Error(`Invalid MarketDesk release tag: ${marketDeskTag}`);
    throw new Error('Release deployment requires HEAD to be checked out at an exact MarketDesk release tag');
  }
  if (releaseTags.length !== 1) {
    throw new Error('Release deployment requires exactly one valid MarketDesk release tag on the commit');
  }
  const [tag] = releaseTags;

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
  const currentReleaseTags = canonicalReleaseTags(commit, cwd);
  if (currentReleaseTags.length !== 1 || currentReleaseTags[0] !== tag) {
    throw new Error('Release tag association changed while it was being validated');
  }
  return { commit, tag };
}

export function resolveCheckoutReleaseTag(cwd = process.cwd()) {
  return resolveCheckoutRelease(cwd).tag;
}

export function assertReleaseAssociation(release, cwd = process.cwd()) {
  const currentCommit = runGit(
    ['rev-parse', '--verify', 'HEAD'],
    cwd,
    'Unable to revalidate the release commit before Compose startup',
  );
  const tags = canonicalReleaseTags(release.commit, cwd);
  if (currentCommit !== release.commit || tags.length !== 1 || tags[0] !== release.tag) {
    throw new Error('Release commit or tag association changed before Compose startup');
  }
}

function acquirePersistentReleaseLock(cwd) {
  const projectName = basename(resolve(cwd));
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    throw new Error(`Checkout directory is not a valid canonical Compose project name: ${projectName}`);
  }
  const lockRoot = '/tmp/marketdesk-release.lock';
  try {
    mkdirSync(lockRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(
        `A MarketDesk release lock already exists at ${lockRoot}; verify that no release process is active before removing it manually`,
      );
    }
    throw error;
  }
  return lockRoot;
}

export function createImmutableReleaseContext(commit, cwd = process.cwd(), root) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Release context requires an exact commit SHA');
  }
  const releaseRoot = root ?? mkdtempSync(join(tmpdir(), RELEASE_CONTEXT_PREFIX));
  if (root) {
    rmSync(releaseRoot, { recursive: true, force: true });
    mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  }
  const context = join(releaseRoot, 'context');
  const archive = join(releaseRoot, 'release.tar');
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
    return { context, root: releaseRoot };
  } catch (error) {
    rmSync(releaseRoot, { recursive: true, force: true });
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

export function buildReleaseComposeArgs(
  args,
  cwd = process.cwd(),
  composeFile,
  envFile,
  externalDatabase = false,
) {
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
    ...(externalDatabase ? ['--scale', 'postgres=0'] : []),
  ];
}

export function releaseUsesExternalDatabase(envFile) {
  const parsed = parseDotenv(readFileSync(resolve(envFile)));
  return Boolean(parsed.DATABASE_URL?.trim());
}

export function buildReleaseComposeEnvironment(
  releaseTag,
  baseEnvironment = process.env,
  releaseContext,
  releaseEnvFile,
) {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('COMPOSE_')) delete environment[name];
  }

  const interpolationNames = new Set();
  if (releaseEnvFile) {
    for (const name of Object.keys(parseDotenv(readFileSync(resolve(releaseEnvFile))))) {
      interpolationNames.add(name);
    }
  }
  if (releaseContext) {
    const composeSource = readFileSync(resolve(releaseContext, 'docker-compose.yml'), 'utf8');
    for (const match of composeSource.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) {
      interpolationNames.add(match[1]);
    }
    for (const match of composeSource.matchAll(/(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
      interpolationNames.add(match[1]);
    }
  }
  for (const name of interpolationNames) delete environment[name];

  environment.MARKETDESK_RELEASE_TAG = releaseTag;
  if (releaseContext) environment.MARKETDESK_BUILD_CONTEXT = releaseContext;
  if (releaseEnvFile) environment.MARKETDESK_ENV_FILE = releaseEnvFile;
  return environment;
}

function waitForChild(child) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({ code, signal }));
  });
}

function signalExitCode(signal) {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal] ?? 1;
}

export async function runReleaseCompose(args, cwd = process.cwd()) {
  const lockRoot = acquirePersistentReleaseLock(cwd);
  let child;
  let composeStarted = false;
  let composeSucceeded = false;
  let receivedSignal;
  const signalHandlers = new Map();
  try {
    const release = resolveCheckoutRelease(cwd);
    const projectName = deriveReleaseProjectName(cwd);
    assertExistingProjectIdentity(projectName, inspectExistingProjectName(cwd));
    const immutable = createImmutableReleaseContext(
      release.commit,
      cwd,
      join(lockRoot, 'deployment'),
    );
    const releaseEnvFile = createReleaseEnvironmentSnapshot(immutable.root, cwd);
    const composeArgs = buildReleaseComposeArgs(
      args,
      cwd,
      resolve(immutable.context, 'docker-compose.yml'),
      releaseEnvFile,
      releaseUsesExternalDatabase(releaseEnvFile),
    );
    assertReleaseAssociation(release, cwd);
    const detached = process.platform !== 'win32';
    child = spawn('docker', composeArgs, {
      cwd,
      detached,
      env: buildReleaseComposeEnvironment(
        release.tag,
        process.env,
        immutable.context,
        releaseEnvFile,
      ),
      stdio: 'inherit',
    });
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
      await waitForChild(child);
      throw new Error('Unable to start Docker Compose');
    }
    composeStarted = true;
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      signalHandlers.set(signal, () => {
        receivedSignal ??= signal;
        const target = detached ? -child.pid : child.pid;
        try {
          process.kill(target, signal);
        } catch (error) {
          if (error?.code !== 'ESRCH') console.error(`Unable to forward ${signal} to Docker Compose`);
        }
      });
    }
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);
    const outcome = await waitForChild(child);
    composeSucceeded = outcome.code === 0 && receivedSignal === undefined;
    return receivedSignal
      ? signalExitCode(receivedSignal)
      : outcome.code ?? signalExitCode(outcome.signal);
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (!composeStarted || composeSucceeded) {
      rmSync(lockRoot, { recursive: true, force: true });
    } else {
      console.error(
        `Release lock retained at ${lockRoot}; verify that no release process is active before removing it manually`,
      );
    }
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  try {
    process.exitCode = await runReleaseCompose(process.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
