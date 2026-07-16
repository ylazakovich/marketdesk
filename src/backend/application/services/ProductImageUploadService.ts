import sharp from 'sharp';
import { isUuid } from '../../../shared/validation/identifiers';
import { ValidationError } from '../../domain/shared/DomainError';
import type {
  IProductImageStorage,
  ProductImageExtension,
  ProductImageMediaType,
  StoredProductImage,
} from '../ports/IProductImageStorage';

const MAX_INPUT_PIXELS = 40_000_000;

const FORMATS: Record<
  string,
  { mediaType: ProductImageMediaType; extension: ProductImageExtension; sharpFormat: 'jpeg' | 'png' | 'webp' }
> = {
  jpeg: { mediaType: 'image/jpeg', extension: 'jpg', sharpFormat: 'jpeg' },
  png: { mediaType: 'image/png', extension: 'png', sharpFormat: 'png' },
  webp: { mediaType: 'image/webp', extension: 'webp', sharpFormat: 'webp' },
};

export class ProductImageUploadService {
  constructor(
    private readonly storage: IProductImageStorage,
    private readonly maxFileSize: number,
  ) {
    if (!Number.isSafeInteger(maxFileSize) || maxFileSize <= 0) {
      throw new Error('Product image maxFileSize must be a positive integer');
    }
  }

  async upload(input: {
    workspaceId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<StoredProductImage> {
    if (typeof input.workspaceId !== 'string' || input.workspaceId.length === 0) {
      throw new ValidationError('Workspace id is required');
    }
    if (typeof input.mediaType !== 'string' || !Buffer.isBuffer(input.bytes)) {
      throw new ValidationError('Image request is malformed');
    }
    // Copy into an application-owned Buffer so downstream code never operates on
    // an Express request value whose runtime shape can be string/array/buffer.
    const bytes = Buffer.from(input.bytes);
    if (bytes.length === 0) throw new ValidationError('Image body is required');
    if (bytes.length > this.maxFileSize) {
      throw new ValidationError(`Image exceeds the ${this.maxFileSize} byte limit`);
    }

    let normalized: Buffer;
    let format: (typeof FORMATS)[string];
    try {
      const decoder = sharp(bytes, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
      });
      const metadata = await decoder.metadata();
      format = FORMATS[metadata.format ?? ''];
      if (!format || !metadata.width || !metadata.height) {
        throw new Error('Unsupported or dimensionless image');
      }
      if (input.mediaType !== format.mediaType) {
        throw new ValidationError('Content-Type does not match the decoded image format');
      }

      // Force a full decode and re-encode. This rejects truncated/polyglot payloads,
      // applies EXIF orientation, and strips untrusted metadata before persistence.
      normalized = await decoder.rotate().toFormat(format.sharpFormat).toBuffer();
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError('Image cannot be decoded as JPEG, PNG, or WebP');
    }

    if (normalized.length > this.maxFileSize) {
      throw new ValidationError(`Normalized image exceeds the ${this.maxFileSize} byte limit`);
    }

    return this.storage.store({
      workspaceId: input.workspaceId,
      bytes: normalized,
      extension: format.extension,
      mediaType: format.mediaType,
    });
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    if (!isUuid(imageId)) throw new ValidationError('Invalid image id');
    return this.storage.delete(workspaceId, imageId);
  }
}
