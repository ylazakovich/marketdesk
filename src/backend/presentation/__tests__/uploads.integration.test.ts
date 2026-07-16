import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import type {
  IProductImageStorage,
  StoreProductImageInput,
  StoredProductImage,
} from '../../application/ports/IProductImageStorage';
import { ProductImageUploadService } from '../../application/services/ProductImageUploadService';
import { ProductImageUploadController } from '../http/controllers/ProductImageUploadController';
import { createErrorHandler } from '../http/middleware/ErrorHandlingMiddleware';
import { authMiddleware, requireWorkspace, signToken } from '../http/middleware/AuthMiddleware';
import { createUploadRoutes } from '../http/routes/uploads';

const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174000';
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#663399' },
  })
    .jpeg()
    .toBuffer();
});

class RecordingStorage implements IProductImageStorage {
  stored: StoreProductImageInput[] = [];
  deleted: Array<{ workspaceId: string; imageId: string }> = [];

  async store(input: StoreProductImageInput): Promise<StoredProductImage> {
    this.stored.push({ ...input, bytes: Buffer.from(input.bytes) });
    return {
      id: IMAGE_ID,
      url: `/uploads/workspaces/scope/products/${IMAGE_ID}.${input.extension}`,
      mediaType: input.mediaType,
      size: input.bytes.length,
    };
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    this.deleted.push({ workspaceId, imageId });
    return imageId === IMAGE_ID;
  }
}

function buildUploadApp(maxFileSize = 1024 * 1024) {
  const storage = new RecordingStorage();
  const service = new ProductImageUploadService(storage, maxFileSize);
  const controller = new ProductImageUploadController(service);
  const app = express();
  app.use(
    '/api/uploads',
    authMiddleware,
    requireWorkspace,
    createUploadRoutes(controller, maxFileSize),
  );
  app.use(createErrorHandler());
  return { app, storage };
}

const token = signToken({ userId: 'user-1', workspaceId: 'workspace-1' });
const noWorkspaceToken = signToken({ userId: 'user-1' });
const auth = (test: request.Test, value = token) =>
  test.set('Authorization', `Bearer ${value}`);

describe('product image upload HTTP contract', () => {
  it('requires authentication and an active workspace', async () => {
    const { app } = buildUploadApp();

    const unauthorized = await request(app)
      .post('/api/uploads/images')
      .set('Content-Type', 'image/jpeg')
      .send(jpeg);
    expect(unauthorized.status).toBe(401);

    const forbidden = await auth(
      request(app).post('/api/uploads/images'),
      noWorkspaceToken,
    )
      .set('Content-Type', 'image/jpeg')
      .send(jpeg);
    expect(forbidden.status).toBe(403);
  });

  it('returns a durable image record and uses the authenticated workspace', async () => {
    const { app, storage } = buildUploadApp();

    const response = await auth(request(app).post('/api/uploads/images'))
      .set('Content-Type', 'image/jpeg')
      .send(jpeg);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: IMAGE_ID,
        url: `/uploads/workspaces/scope/products/${IMAGE_ID}.jpg`,
        mediaType: 'image/jpeg',
        size: expect.any(Number),
      },
    });
    expect(storage.stored[0]).toMatchObject({
      workspaceId: 'workspace-1',
      extension: 'jpg',
      mediaType: 'image/jpeg',
    });
  });

  it('rejects unsupported or signature-mismatched image data', async () => {
    const { app } = buildUploadApp();

    const unsupported = await auth(request(app).post('/api/uploads/images'))
      .set('Content-Type', 'image/gif')
      .send(Buffer.from('GIF89a'));
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('VALIDATION_ERROR');

    const mismatch = await auth(request(app).post('/api/uploads/images'))
      .set('Content-Type', 'image/png')
      .send(jpeg);
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a safe 413 envelope before buffering an oversized image', async () => {
    const { app } = buildUploadApp(4);

    const response = await auth(request(app).post('/api/uploads/images'))
      .set('Content-Type', 'image/jpeg')
      .send(jpeg);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the configured limit',
      },
    });
  });

  it('deletes through the authenticated workspace and reports missing images', async () => {
    const { app, storage } = buildUploadApp();

    const removed = await auth(request(app).delete(`/api/uploads/images/${IMAGE_ID}`));
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ success: true, data: { deleted: true } });
    expect(storage.deleted).toEqual([{ workspaceId: 'workspace-1', imageId: IMAGE_ID }]);

    const missing = await auth(
      request(app).delete('/api/uploads/images/123e4567-e89b-42d3-a456-426614174999'),
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
