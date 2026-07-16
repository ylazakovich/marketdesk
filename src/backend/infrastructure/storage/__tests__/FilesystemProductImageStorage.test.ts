import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesystemProductImageStorage } from '../FilesystemProductImageStorage';

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('FilesystemProductImageStorage', () => {
  let uploadDir: string;

  beforeEach(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), 'marketdesk-upload-'));
  });

  afterEach(async () => {
    await rm(uploadDir, { recursive: true, force: true });
  });

  it('writes an opaque image below a hashed workspace directory', async () => {
    const storage = new FilesystemProductImageStorage(uploadDir, () => IMAGE_ID);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const stored = await storage.store({
      workspaceId: 'workspace/with/path-characters',
      bytes,
      extension: 'jpg',
      mediaType: 'image/jpeg',
    });

    expect(stored).toMatchObject({
      id: IMAGE_ID,
      mediaType: 'image/jpeg',
      size: bytes.length,
    });
    expect(stored.url).toMatch(
      new RegExp(`^/uploads/workspaces/[0-9a-f]{24}/products/${IMAGE_ID}\\.jpg$`),
    );
    expect(stored.url).not.toContain('workspace/with');
    await expect(readFile(path.join(uploadDir, stored.url.replace('/uploads/', '')))).resolves.toEqual(
      bytes,
    );
  });

  it('deletes only an image in the requested workspace', async () => {
    const storage = new FilesystemProductImageStorage(uploadDir, () => IMAGE_ID);
    const stored = await storage.store({
      workspaceId: 'workspace-a',
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      extension: 'jpg',
      mediaType: 'image/jpeg',
    });

    await expect(storage.delete('workspace-b', IMAGE_ID)).resolves.toBe(false);
    await expect(readFile(path.join(uploadDir, stored.url.replace('/uploads/', '')))).resolves.toBeDefined();
    await expect(storage.delete('workspace-a', IMAGE_ID)).resolves.toBe(true);
    await expect(storage.delete('workspace-a', IMAGE_ID)).resolves.toBe(false);
  });

  it('enforces workspace byte and file quotas before writing another image', async () => {
    const ids = [
      IMAGE_ID,
      '223e4567-e89b-42d3-a456-426614174000',
      '323e4567-e89b-42d3-a456-426614174000',
    ];
    const storage = new FilesystemProductImageStorage(
      uploadDir,
      () => ids.shift()!,
      { maxWorkspaceBytes: 8, maxWorkspaceFiles: 2 },
    );
    const input = {
      workspaceId: 'workspace-a',
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      extension: 'jpg' as const,
      mediaType: 'image/jpeg' as const,
    };

    await expect(storage.store(input)).resolves.toBeDefined();
    await expect(storage.store(input)).resolves.toBeDefined();
    await expect(storage.store(input)).rejects.toMatchObject({
      code: 'GUARDRAIL_VIOLATION',
    });
  });

  it('serializes concurrent writes so quota checks cannot race in one app process', async () => {
    const ids = [IMAGE_ID, '223e4567-e89b-42d3-a456-426614174000'];
    const storage = new FilesystemProductImageStorage(
      uploadDir,
      () => ids.shift()!,
      { maxWorkspaceBytes: 4, maxWorkspaceFiles: 10 },
    );
    const input = {
      workspaceId: 'workspace-a',
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      extension: 'jpg' as const,
      mediaType: 'image/jpeg' as const,
    };

    const results = await Promise.allSettled([storage.store(input), storage.store(input)]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});
