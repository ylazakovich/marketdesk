// Products endpoints, injected into the shared baseApi (Group 8).
import type {
  Product,
  Listing,
  PaginatedResponse,
  ApiResponse,
  ProductAIDraft,
  ProductAIDraftRequest,
} from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap, unwrapPaginated } from './envelope.js';
import type { PaginatedApiResponse } from './envelope.js';
import type {
  ProductListParams,
  CreateProductInput,
  UpdateProductArg,
  CreateProductListingInput,
} from './dto.js';

export interface ProductImageUpload {
  id: string;
  url: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
}

export function buildProductImageUploadRequest(file: File) {
  return {
    url: '/uploads/images',
    method: 'POST' as const,
    body: file,
    headers: { 'content-type': file.type },
  };
}

export function buildProductImageDeleteRequest(imageId: string) {
  return { url: `/uploads/images/${imageId}`, method: 'DELETE' as const };
}

export function buildProductsListUrl(params?: ProductListParams): string {
  const { tags, ...rest } = params ?? {};
  return `/products${buildQueryString({
    ...rest,
    tags: tags?.length ? JSON.stringify(tags) : undefined,
  })}`;
}

export const productsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProducts: builder.query<PaginatedResponse<Product>, ProductListParams | void>({
      query: (params) => buildProductsListUrl(params ?? undefined),
      transformResponse: (res: PaginatedApiResponse<Product>) => unwrapPaginated(res),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((p) => ({ type: 'Product' as const, id: p.id })),
              { type: 'Product' as const, id: 'LIST' },
            ]
          : [{ type: 'Product' as const, id: 'LIST' }],
    }),

    getProduct: builder.query<Product, string>({
      query: (id) => `/products/${id}`,
      transformResponse: (res: ApiResponse<Product>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Product', id }],
    }),

    createProduct: builder.mutation<Product, CreateProductInput>({
      query: (body) => ({ url: '/products', method: 'POST', body }),
      transformResponse: (res: ApiResponse<Product>) => unwrap(res),
      invalidatesTags: [{ type: 'Product', id: 'LIST' }],
    }),

    generateProductAIDraft: builder.mutation<ProductAIDraft, ProductAIDraftRequest>({
      query: (body) => ({ url: '/products/ai-draft', method: 'POST', body }),
      transformResponse: (res: ApiResponse<ProductAIDraft>) => unwrap(res),
    }),

    uploadProductImage: builder.mutation<ProductImageUpload, File>({
      query: buildProductImageUploadRequest,
      transformResponse: (res: ApiResponse<ProductImageUpload>) => unwrap(res),
    }),

    deleteProductImage: builder.mutation<{ deleted: boolean }, string>({
      query: buildProductImageDeleteRequest,
      transformResponse: (res: ApiResponse<{ deleted: boolean }>) => unwrap(res),
    }),

    updateProduct: builder.mutation<Product, UpdateProductArg>({
      query: ({ id, patch }) => ({ url: `/products/${id}`, method: 'PATCH', body: patch }),
      transformResponse: (res: ApiResponse<Product>) => unwrap(res),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Product', id },
        { type: 'Product', id: 'LIST' },
      ],
    }),

    deleteProduct: builder.mutation<{ id: string }, string>({
      query: (id) => ({ url: `/products/${id}`, method: 'DELETE' }),
      transformResponse: (_res: ApiResponse<unknown>, _meta, id) => ({ id }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Product', id },
        { type: 'Product', id: 'LIST' },
        { type: 'Listing', id: 'LIST' },
      ],
    }),

    createProductListing: builder.mutation<Listing, CreateProductListingInput>({
      query: ({ productId, ...body }) => ({
        url: `/products/${productId}/listings`,
        method: 'POST',
        body,
      }),
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      invalidatesTags: (result, _error, { productId }) => [
        { type: 'Product', id: productId },
        { type: 'Listing', id: `PRODUCT:${productId}` },
        ...(result ? [{ type: 'Listing' as const, id: result.id }] : []),
      ],
    }),

    getProductListings: builder.query<Listing[], string>({
      query: (id) => `/products/${id}/listings`,
      transformResponse: (res: ApiResponse<Listing[]>) => unwrap(res),
      providesTags: (result, _error, id) =>
        result
          ? [
              ...result.map((l) => ({ type: 'Listing' as const, id: l.id })),
              { type: 'Listing' as const, id: `PRODUCT:${id}` },
            ]
          : [{ type: 'Listing' as const, id: `PRODUCT:${id}` }],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetProductQuery,
  useCreateProductMutation,
  useGenerateProductAIDraftMutation,
  useUploadProductImageMutation,
  useDeleteProductImageMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useCreateProductListingMutation,
  useGetProductListingsQuery,
} = productsApi;
