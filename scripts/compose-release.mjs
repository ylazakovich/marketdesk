#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_TAG_PATTERN = /^hermes-marketdesk-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function resolveCheckoutReleaseTag(cwd = process.cwd()) {
  const result = spawnSync(
    'git',
    ['describe', '--tags', '--exact-match', '--match', 'hermes-marketdesk-v[0-9]*', 'HEAD'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('Release deployment requires HEAD to be checked out at an exact MarketDesk release tag');
  }

  const tag = result.stdout.trim();
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
  return tag;
}

export function deriveReleaseProjectName(cwd = process.cwd()) {
  const projectDirectory = resolve(cwd);
  try {
    const envFile = readFileSync(resolve(projectDirectory, '.env'), 'utf8');
    const hasOverride = envFile.split(/\r?\n/).some((line) =>
      /^(?:\s*export\s+)?\s*COMPOSE_PROJECT_NAME\s*=/.test(line) && !/^\s*#/.test(line),
    );
    if (hasOverride) {
      throw new Error('Release deployment forbids COMPOSE_PROJECT_NAME in .env; use the existing checkout directory identity');
    }
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
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/no such (?:object|container)/i.test(diagnostic)) return undefined;
  throw new Error('Unable to verify the existing MarketDesk Compose project identity');
}

export function inspectExistingProjectName(cwd) {
  return parseExistingProjectInspection(spawnSync(
    'docker',
    ['inspect', 'marketdesk-app', '--format', '{{ index .Config.Labels "com.docker.compose.project" }}'],
    { cwd, encoding: 'utf8' },
  ));
}

export function buildReleaseComposeArgs(args, cwd = process.cwd()) {
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
    '-f', resolve(projectDirectory, 'docker-compose.yml'),
    'up', '--build', '--detach',
  ];
}

export function buildReleaseComposeEnvironment(releaseTag, baseEnvironment = process.env) {
  const environment = { ...baseEnvironment, MARKETDESK_RELEASE_TAG: releaseTag };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('COMPOSE_')) delete environment[name];
  }
  return environment;
}

export function runReleaseCompose(args, cwd = process.cwd()) {
  const composeArgs = buildReleaseComposeArgs(args, cwd);
  const releaseTag = resolveCheckoutReleaseTag(cwd);
  const projectName = deriveReleaseProjectName(cwd);
  assertExistingProjectIdentity(projectName, inspectExistingProjectName(cwd));
  const result = spawnSync('docker', composeArgs, {
    cwd,
    env: buildReleaseComposeEnvironment(releaseTag),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
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
