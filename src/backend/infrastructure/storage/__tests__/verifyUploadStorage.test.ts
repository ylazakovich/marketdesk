import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type UploadStorageFs,
  verifyUploadStorageWritable,
} from '../verifyUploadStorage';

describe('verifyUploadStorageWritable', () => {
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'marketdesk-storage-startup-'));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('creates the workspace root, proves write/delete, and preserves legacy uploads', async () => {
    const legacyFile = path.join(uploadDir, 'legacy', 'existing.jpg');
    await mkdir(path.dirname(legacyFile), { recursive: true });
    await writeFile(legacyFile, 'existing upload');

    await expect(verifyUploadStorageWritable(uploadDir)).resolves.toBe(path.resolve(uploadDir));

    await expect(access(path.join(uploadDir, 'workspaces'))).resolves.toBeUndefined();
    await expect(readFile(legacyFile, 'utf8')).resolves.toBe('existing upload');
  });

  it('fails with an actionable startup error when the write probe is denied', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const filesystem: UploadStorageFs = {
      mkdir: async (directory, options) => mkdir(directory, options),
      open: async () => {
        throw denied;
      },
      unlink: async () => undefined,
    };

    await expect(verifyUploadStorageWritable(uploadDir, filesystem)).rejects.toThrow(
      new RegExp(`Upload storage is not writable at ${uploadDir}.*UID 1001.*EACCES`),
    );
  });
});