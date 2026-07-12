// Listings endpoints, injected into the shared baseApi (Group 8).
import type { Listing, PriceHistory, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap } from './envelope.js';
import type {
  ListingListParams,
  PublishListingInput,
  UpdateListingArg,
} from './dto.js';

export const listingsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getListings: builder.query<Listing[], ListingListParams | void>({
      query: (params) => `/listings${buildQueryString({ ...(params ?? {}) })}`,
      transformResponse: (res: ApiResponse<Listing[]>) => unwrap(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((l) => ({ type: 'Listing' as const, id: l.id })),
              { type: 'Listing' as const, id: 'LIST' },
            ]
          : [{ type: 'Listing' as const, id: 'LIST' }],
    }),

    getListing: builder.query<Listing, string>({
      query: (id) => `/listings/${id}`,
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Listing', id }],
    }),

    // POST /listings/:id/publish — publish an existing (draft) listing.
    publishListing: builder.mutation<Listing, PublishListingInput>({
      query: ({ id, ...body }) => ({ url: `/listings/${id}/publish`, method: 'POST', body }),
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      invalidatesTags: (result, _error, { id }) => [
        { type: 'Listing', id },
        { type: 'Listing', id: 'LIST' },
        ...(result ? [{ type: 'Product' as const, id: result.productId }] : []),
        { type: 'Product', id: 'LIST' },
      ],
    }),

    // PATCH /listings/:id — update price (with optional reason).
    updateListing: builder.mutation<Listing, UpdateListingArg>({
      query: ({ id, patch }) => ({ url: `/listings/${id}`, method: 'PATCH', body: patch }),
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      invalidatesTags: (result, _error, { id }) => [
        { type: 'Listing', id },
        { type: 'Listing', id: 'LIST' },
        ...(result ? [{ type: 'Product' as const, id: result.productId }] : []),
        { type: 'Product', id: 'LIST' },
      ],
    }),

    // POST /listings/:id/relist — republish an expired/errored listing (202).
    relistListing: builder.mutation<Listing, string>({
      query: (id) => ({ url: `/listings/${id}/relist`, method: 'POST' }),
      transformResponse: (res: ApiResponse<Listing>) => unwrap(res),
      invalidatesTags: (result, _error, id) => [
        { type: 'Listing', id },
        { type: 'Listing', id: 'LIST' },
        ...(result ? [{ type: 'Product' as const, id: result.productId }] : []),
        { type: 'Product', id: 'LIST' },
      ],
    }),

    getPriceHistory: builder.query<PriceHistory[], string>({
      query: (id) => `/listings/${id}/price-history`,
      transformResponse: (res: ApiResponse<PriceHistory[]>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Listing', id }],
    }),
  }),
});

export const {
  useGetListingsQuery,
  useGetListingQuery,
  usePublishListingMutation,
  useUpdateListingMutation,
  useRelistListingMutation,
  useGetPriceHistoryQuery,
} = listingsApi;
