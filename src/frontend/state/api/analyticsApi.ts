// Analytics endpoints, injected into the shared baseApi (Group 8).
import type { ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { buildQueryString } from './queryString.js';
import { unwrap } from './envelope.js';
import type {
  AnalyticsQueryParams,
  AnalyticsOverview,
  AnalyticsRevenue,
  ListingPerformance,
} from './dto.js';

export const analyticsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAnalyticsOverview: builder.query<AnalyticsOverview, AnalyticsQueryParams | void>({
      query: (params) => `/analytics/overview${buildQueryString({ ...(params ?? {}) })}`,
      transformResponse: (res: ApiResponse<AnalyticsOverview>) => unwrap(res),
      providesTags: [{ type: 'Analytics', id: 'OVERVIEW' }],
    }),

    getAnalyticsRevenue: builder.query<AnalyticsRevenue, AnalyticsQueryParams | void>({
      query: (params) => `/analytics/revenue${buildQueryString({ ...(params ?? {}) })}`,
      transformResponse: (res: ApiResponse<AnalyticsRevenue>) => unwrap(res),
      providesTags: [{ type: 'Analytics', id: 'REVENUE' }],
    }),

    getAnalyticsListings: builder.query<ListingPerformance[], AnalyticsQueryParams | void>({
      query: (params) => `/analytics/listings${buildQueryString({ ...(params ?? {}) })}`,
      transformResponse: (res: ApiResponse<ListingPerformance[]>) => unwrap(res),
      providesTags: [{ type: 'Analytics', id: 'LISTINGS' }],
    }),
  }),
});

export const {
  useGetAnalyticsOverviewQuery,
  useGetAnalyticsRevenueQuery,
  useGetAnalyticsListingsQuery,
} = analyticsApi;
