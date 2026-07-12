// Products endpoints, injected into the shared baseApi (Group 8).
import type { Product, Listing, PaginatedResponse, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap, unwrapPaginated } from './envelope.js';
import type { PaginatedApiResponse } from './envelope.js';
import type {
  ProductListParams,
  CreateProductInput,
  UpdateProductArg,
} from './dto.js';

export const productsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProducts: builder.query<PaginatedResponse<Product>, ProductListParams | void>({
      query: (params) => `/products${buildQueryString({ ...(params ?? {}) })}`,
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

    getProductListings: builder.query<Listing[], string>({
      query: (id) => `/products/${id}/listings`,
      transformResponse: (res: ApiResponse<Listing[]>) => unwrap(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((l) => ({ type: 'Listing' as const, id: l.id })),
              { type: 'Listing' as const, id: 'LIST' },
            ]
          : [{ type: 'Listing' as const, id: 'LIST' }],
    }),
  }),
});

export const {
  useGetProductsQuery,
  useGetProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useGetProductListingsQuery,
} = productsApi;
