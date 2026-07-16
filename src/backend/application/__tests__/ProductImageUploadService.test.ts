import sharp from 'sharp';
import type {
  IProductImageStorage,
  StoredProductImage,
} from '../ports/IProductImageStorage';
import { ProductImageUploadService } from '../services/ProductImageUploadService';

class RecordingStorage implements IProductImageStorage {
  stored: Array<{
    workspaceId: string;
    bytes: Buffer;
    extension: 'jpg' | 'png' | 'webp';
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  }> = [];
  deleted: Array<{ workspaceId: string; imageId: string }> = [];

  async store(input: (typeof this.stored)[number]): Promise<StoredProductImage> {
    this.stored.push({ ...input, bytes: Buffer.from(input.bytes) });
    return {
      id: '123e4567-e89b-42d3-a456-426614174000',
      url: '/uploads/workspaces/ws/products/123e4567-e89b-42d3-a456-426614174000.jpg',
      mediaType: input.mediaType,
      size: input.bytes.length,
    };
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    this.deleted.push({ workspaceId, imageId });
    return true;
  }
}

let jpeg: Buffer;
let png: Buffer;
let webp: Buffer;

beforeAll(async () => {
  const source = sharp({
    create: { width: 2, height: 2, channels: 3, background: '#663399' },
  });
  [jpeg, png, webp] = await Promise.all([
    source.clone().jpeg().toBuffer(),
    source.clone().png().toBuffer(),
    source.clone().webp().toBuffer(),
  ]);
});

describe('ProductImageUploadService', () => {
  it.each([
    ['image/jpeg' as const, () => jpeg, 'jpg' as const, 'jpeg'],
    ['image/png' as const, () => png, 'png' as const, 'png'],
    ['image/webp' as const, () => webp, 'webp' as const, 'webp'],
  ])('stores a fully decoded %s image in the authenticated workspace', async (mediaType, bytes, extension, decodedFormat) => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024 * 1024);

    const result = await service.upload({ workspaceId: 'ws-1', mediaType, bytes: bytes() });

    expect(result.url).toMatch(/^\/uploads\//);
    expect(storage.stored[0]).toMatchObject({ workspaceId: 'ws-1', mediaType, extension });
    await expect(sharp(storage.stored[0]!.bytes).metadata()).resolves.toMatchObject({
      format: decodedFormat,
      width: 2,
      height: 2,
    });
  });

  it('rejects an empty image', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 1024);

    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/jpeg', bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a MIME type that does not match the decoded format', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 1024 * 1024);

    await expect(
      service.upload({ workspaceId: 'ws-1', mediaType: 'image/png', bytes: jpeg }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects truncated and magic-prefix-only payloads', async () => {
    const service = new ProductImageUploadService(new RecordingStorage(), 1024);

    await expect(
      service.upload({
        workspaceId: 'ws-1',
        mediaType: 'image/jpeg',
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.upload({
        workspaceId: 'ws-1',
        mediaType: 'image/png',
        bytes: png.subarray(0, 16),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects unsupported and oversized image data through distinct validation paths', async () => {
    const largeLimitService = new ProductImageUploadService(new RecordingStorage(), 1024);
    await expect(
      largeLimitService.upload({
        workspaceId: 'ws-1',
        mediaType: 'image/gif',
        bytes: Buffer.from('GIF89a'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const smallLimitService = new ProductImageUploadService(new RecordingStorage(), 4);
    await expect(
      smallLimitService.upload({ workspaceId: 'ws-1', mediaType: 'image/jpeg', bytes: jpeg }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('fails fast for an invalid configured file-size limit', () => {
    expect(() => new ProductImageUploadService(new RecordingStorage(), Number.NaN)).toThrow(
      /positive integer/,
    );
  });

  it('deletes only through the authenticated workspace scope', async () => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024);

    await expect(
      service.delete('ws-1', '123e4567-e89b-42d3-a456-426614174000'),
    ).resolves.toBe(true);
    expect(storage.deleted).toEqual([
      { workspaceId: 'ws-1', imageId: '123e4567-e89b-42d3-a456-426614174000' },
    ]);
  });

  it('rejects non-UUID image ids before touching storage', async () => {
    const storage = new RecordingStorage();
    const service = new ProductImageUploadService(storage, 1024);

    await expect(service.delete('ws-1', '../../other-workspace/image')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(storage.deleted).toEqual([]);
  });
});
