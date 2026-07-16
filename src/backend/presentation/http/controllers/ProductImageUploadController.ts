import type { NextFunction, Request, Response } from 'express';
import type { ProductImageUploadService } from '../../../application/services/ProductImageUploadService';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { created, ok } from '../formatters/ResponseFormatter';

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export class ProductImageUploadController {
  constructor(private readonly images: ProductImageUploadService) {}

  upload = async (req: Request, res: Response): Promise<void> => {
    const contentType = (req.headers['content-type'] ?? '')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const image = await this.images.upload({
      workspaceId: req.user!.workspaceId!,
      mediaType: contentType ?? '',
      bytes,
    });
    created(res, image);
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const imageId = routeParam(req.params.id);
    const deleted = await this.images.delete(req.user!.workspaceId!, imageId);
    if (!deleted) {
      next(new NotFoundError(`Product image not found: ${imageId}`));
      return;
    }
    ok(res, { deleted: true });
  };
}
