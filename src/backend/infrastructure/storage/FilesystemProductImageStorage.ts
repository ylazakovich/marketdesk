import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isUuid } from '../../../shared/validation/identifiers';
import type {
  IProductImageStorage,
  ProductImageExtension,
  StoreProductImageInput,
  StoredProductImage,
} from '../../application/ports/IProductImageStorage';
import {
  ConfigurationError,
  GuardrailViolationError,
  ValidationError,
} from '../../domain/shared/DomainError';

const EXTENSIONS: readonly ProductImageExtension[] = ['jpg', 'png', 'webp'];

function workspaceKey(workspaceId: string): string {
  return createHash('sha256').update(workspaceId).digest('hex').slice(0, 24);
}

async function directoryUsage(directory: string): Promise<{ bytes: number; files: number }> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bytes: 0, files: 0 };
    throw error;
  }

  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await directoryUsage(entryPath);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      bytes += (await stat(entryPath)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

export interface ProductImageStorageLimits {
  maxWorkspaceBytes: number;
  maxWorkspaceFiles: number;
}

export class FilesystemProductImageStorage implements IProductImageStorage {
  private readonly workspaceQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly uploadDir: string,
    private readonly generateId: () => string = randomUUID,
    private readonly limits: ProductImageStorageLimits = {
      maxWorkspaceBytes: 1_073_741_824,
      maxWorkspaceFiles: 1_200,
    },
  ) {
    if (!Number.isSafeInteger(limits.maxWorkspaceBytes) || limits.maxWorkspaceBytes <= 0) {
      throw new ConfigurationError('maxWorkspaceBytes must be a positive integer');
    }
    if (!Number.isSafeInteger(limits.maxWorkspaceFiles) || limits.maxWorkspaceFiles <= 0) {
      throw new ConfigurationError('maxWorkspaceFiles must be a positive integer');
    }
  }

  async store(input: StoreProductImageInput): Promise<StoredProductImage> {
    return this.withWorkspaceLock(input.workspaceId, async () => {
      const id = this.generateId();
      if (!isUuid(id)) {
        throw new ConfigurationError('Product image id generator returned an invalid UUID');
      }
      if (!EXTENSIONS.includes(input.extension)) {
        throw new ValidationError('Unsupported product image extension');
      }

      const workspace = workspaceKey(input.workspaceId);
      const workspaceDirectory = path.resolve(this.uploadDir, 'workspaces', workspace);
      const usage = await directoryUsage(workspaceDirectory);
      if (usage.files + 1 > this.limits.maxWorkspaceFiles) {
        throw new GuardrailViolationError('Workspace image file quota exceeded', {
          maxWorkspaceFiles: this.limits.maxWorkspaceFiles,
        });
      }
      if (usage.bytes + input.bytes.length > this.limits.maxWorkspaceBytes) {
        throw new GuardrailViolationError('Workspace image storage quota exceeded', {
          maxWorkspaceBytes: this.limits.maxWorkspaceBytes,
        });
      }

      const relativePath = path.join('workspaces', workspace, 'products', `${id}.${input.extension}`);
      const absolutePath = path.resolve(this.uploadDir, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.bytes, { flag: 'wx' });

      return {
        id,
        url: `/uploads/${relativePath.split(path.sep).join('/')}`,
        mediaType: input.mediaType,
        size: input.bytes.length,
      };
    });
  }

  async delete(workspaceId: string, imageId: string): Promise<boolean> {
    if (!isUuid(imageId)) throw new ValidationError('Invalid image id');
    return this.withWorkspaceLock(workspaceId, async () => {
      const directory = path.resolve(this.uploadDir, 'workspaces', workspaceKey(workspaceId), 'products');
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }

      // Build deletion paths only from names returned by the filesystem. The
      // request-provided UUID participates solely in an exact basename match.
      const matches = entries.filter((entry) => {
        if (!entry.isFile()) return false;
        const extension = path.extname(entry.name).slice(1) as ProductImageExtension;
        return EXTENSIONS.includes(extension) && path.basename(entry.name, `.${extension}`) === imageId;
      });
      await Promise.all(matches.map((entry) => unlink(path.join(directory, entry.name))));
      return matches.length > 0;
    });
  }

  private async withWorkspaceLock<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const key = workspaceKey(workspaceId);
    const previous = this.workspaceQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.workspaceQueues.set(key, queued);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.workspaceQueues.get(key) === queued) this.workspaceQueues.delete(key);
    }
  }
}
