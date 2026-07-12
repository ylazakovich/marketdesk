// RTK Query base API. Per-entity endpoints are injected in Group 8 via
// `baseApi.injectEndpoints(...)`. This module only sets up the shared query,
// auth header, and cache tag types.
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { API_BASE_URL } from '@shared/constants';

// Minimal shape of the slice this query reads. Typed locally to avoid a
// circular import with store.ts (which imports baseApi).
interface AuthAware {
  auth: { token: string | null };
}

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: API_BASE_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as AuthAware).auth?.token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  tagTypes: ['Product', 'Listing', 'Marketplace', 'HermesEvent', 'Analytics'],
  endpoints: () => ({}),
});

export default baseApi;
