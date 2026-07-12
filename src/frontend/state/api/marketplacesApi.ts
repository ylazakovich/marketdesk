// Marketplaces endpoints, injected into the shared baseApi (Group 8).
import type { Marketplace, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';
import type {
  ConnectMarketplaceInput,
  UpdateMarketplaceArg,
} from './dto.js';

export const marketplacesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMarketplaces: builder.query<Marketplace[], void>({
      query: () => '/marketplaces',
      transformResponse: (res: ApiResponse<Marketplace[]>) => unwrap(res),
      providesTags: (result) =>
        result
          ? [
              ...result.map((m) => ({ type: 'Marketplace' as const, id: m.id })),
              { type: 'Marketplace' as const, id: 'LIST' },
            ]
          : [{ type: 'Marketplace' as const, id: 'LIST' }],
    }),

    getMarketplace: builder.query<Marketplace, string>({
      query: (id) => `/marketplaces/${id}`,
      transformResponse: (res: ApiResponse<Marketplace>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Marketplace', id }],
    }),

    // POST /marketplaces/:id/sync — enqueue a sync; may also refresh listings.
    syncMarketplace: builder.mutation<Marketplace, string>({
      query: (id) => ({ url: `/marketplaces/${id}/sync`, method: 'POST' }),
      transformResponse: (res: ApiResponse<Marketplace>) => unwrap(res),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Marketplace', id },
        { type: 'Listing', id: 'LIST' },
      ],
    }),

    connectMarketplace: builder.mutation<
      Marketplace,
      { id: string; input?: ConnectMarketplaceInput }
    >({
      query: ({ id, input }) => ({
        url: `/marketplaces/${id}/connect`,
        method: 'POST',
        body: input ?? {},
      }),
      transformResponse: (res: ApiResponse<Marketplace>) => unwrap(res),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Marketplace', id },
        { type: 'Marketplace', id: 'LIST' },
      ],
    }),

    updateMarketplace: builder.mutation<Marketplace, UpdateMarketplaceArg>({
      query: ({ id, patch }) => ({
        url: `/marketplaces/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      transformResponse: (res: ApiResponse<Marketplace>) => unwrap(res),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Marketplace', id },
        { type: 'Marketplace', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useGetMarketplacesQuery,
  useGetMarketplaceQuery,
  useSyncMarketplaceMutation,
  useConnectMarketplaceMutation,
  useUpdateMarketplaceMutation,
} = marketplacesApi;
