import { readFileSync } from 'node:fs';

const RELEASE_TAG_PATTERN = /^marketdesk-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
export const EMBEDDED_RELEASE_TAG_PATH = '/app/.marketdesk-release-tag';

export type ApplicationVersion = `v${string}` | 'Development' | 'Version unavailable';

export function resolveApplicationVersion(releaseTag: string | undefined): ApplicationVersion {
  if (releaseTag === undefined || releaseTag === '') return 'Development';

  const match = RELEASE_TAG_PATTERN.exec(releaseTag);
  return match ? `v${match[1]}` : 'Version unavailable';
}

export function readEmbeddedApplicationVersion(
  releaseTagPath = EMBEDDED_RELEASE_TAG_PATH,
): ApplicationVersion {
  try {
    return resolveApplicationVersion(readFileSync(releaseTagPath, 'utf8'));
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
    return code === 'ENOENT' ? 'Development' : 'Version unavailable';
  }
}
