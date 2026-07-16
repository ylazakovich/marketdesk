export type ProductImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ProductImageExtension = 'jpg' | 'png' | 'webp';

export interface StoredProductImage {
  id: string;
  url: string;
  mediaType: ProductImageMediaType;
  size: number;
}

export interface StoreProductImageInput {
  workspaceId: string;
  bytes: Buffer;
  extension: ProductImageExtension;
  mediaType: ProductImageMediaType;
}

export interface IProductImageStorage {
  store(input: StoreProductImageInput): Promise<StoredProductImage>;
  delete(workspaceId: string, imageId: string): Promise<boolean>;
}
