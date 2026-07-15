// Marketplaces endpoints, injected into the shared baseApi (Group 8).
import type { Marketplace, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';
import type {
  ConnectMarketplaceInput,
  MarketplaceOAuthStart,
  MarketplaceOAuthStatus,
  MarketplaceAppCredentialStatus,
  SaveMarketplaceAppCredentialsArg,
  UpdateMarketplaceArg,
  MarketplaceImportPreview,
  MarketplaceImportPreviewInput,
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

    getMarketplaceAppCredentials: builder.query<MarketplaceAppCredentialStatus, string>({
      query: (id) => `/marketplaces/${id}/app-credentials`,
      transformResponse: (res: ApiResponse<MarketplaceAppCredentialStatus>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Marketplace', id }],
    }),

    saveMarketplaceAppCredentials: builder.mutation<
      MarketplaceAppCredentialStatus,
      SaveMarketplaceAppCredentialsArg
    >({
      query: ({ id, input }) => ({
        url: `/marketplaces/${id}/app-credentials`,
        method: 'PUT',
        body: input,
      }),
      transformResponse: (res: ApiResponse<MarketplaceAppCredentialStatus>) => unwrap(res),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Marketplace', id }],
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

    // Starts provider OAuth. Connection is not marked successful until callback completes.
    connectMarketplace: builder.mutation<
      MarketplaceOAuthStart,
      { id: string; input?: ConnectMarketplaceInput }
    >({
      query: ({ id, input }) => ({
        url: `/marketplaces/${id}/connect`,
        method: 'POST',
        body: input ?? {},
      }),
      transformResponse: (res: ApiResponse<MarketplaceOAuthStart>) => unwrap(res),
    }),

    checkMarketplace: builder.query<MarketplaceOAuthStatus, string>({
      query: (id) => `/marketplaces/${id}/check`,
      transformResponse: (res: ApiResponse<MarketplaceOAuthStatus>) => unwrap(res),
      providesTags: (_result, _error, id) => [{ type: 'Marketplace', id }],
    }),

    importMarketplacePreview: builder.mutation<MarketplaceImportPreview, MarketplaceImportPreviewInput>({
      query: ({ id, pageSize, statuses }) => ({
        url: `/marketplaces/${id}/import-preview`,
        method: 'POST',
        body: { pageSize, statuses },
      }),
      transformResponse: (res: ApiResponse<MarketplaceImportPreview>) => unwrap(res),
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
  useGetMarketplaceAppCredentialsQuery,
  useSaveMarketplaceAppCredentialsMutation,
  useSyncMarketplaceMutation,
  useConnectMarketplaceMutation,
  useLazyCheckMarketplaceQuery,
  useImportMarketplacePreviewMutation,
  useUpdateMarketplaceMutation,
} = marketplacesApi;
