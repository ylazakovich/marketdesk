import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readEmbeddedApplicationVersion,
  resolveApplicationVersion,
} from './applicationVersion';

describe('resolveApplicationVersion', () => {
  it('normalizes an exact MarketDesk release tag for display', () => {
    expect(resolveApplicationVersion('hermes-marketdesk-v0.10.0')).toBe('v0.10.0');
  });

  it.each([undefined, ''])('shows Development when release metadata is absent: %p', (value) => {
    expect(resolveApplicationVersion(value)).toBe('Development');
  });

  it.each([
    'v0.10.0',
    'hermes-marketdesk-v0.10',
    'hermes-marketdesk-v0.10.0-rc.1',
    'hermes-marketdesk-v0.10.0 dirty',
    'hermes-marketdesk-v01.10.0',
    ' hermes-marketdesk-v0.10.0 ',
    'hermes-marketdesk-v0.10.0\n',
    '   ',
  ])('does not invent a production version from malformed metadata: %s', (value) => {
    expect(resolveApplicationVersion(value)).toBe('Version unavailable');
  });
});

describe('readEmbeddedApplicationVersion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'marketdesk-version-test-'));
  const releaseFile = join(directory, '.marketdesk-release-tag');

  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('reads the version from the immutable artifact metadata file', () => {
    writeFileSync(releaseFile, 'hermes-marketdesk-v0.10.0');
    expect(readEmbeddedApplicationVersion(releaseFile)).toBe('v0.10.0');
  });

  it('uses Development when the artifact metadata file is absent', () => {
    expect(readEmbeddedApplicationVersion(join(directory, 'missing'))).toBe('Development');
  });

  it('does not normalize malformed artifact file content', () => {
    writeFileSync(releaseFile, 'hermes-marketdesk-v0.10.0\n');
    expect(readEmbeddedApplicationVersion(releaseFile)).toBe('Version unavailable');
  });
});
