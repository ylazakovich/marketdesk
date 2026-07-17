import type { ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

export interface ApplicationInfo {
  version: string;
}

export const applicationInfoApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getApplicationInfo: builder.query<ApplicationInfo, void>({
      query: () => '/application-info',
      transformResponse: (response: ApiResponse<ApplicationInfo>) => unwrap(response),
    }),
  }),
});

export const { useGetApplicationInfoQuery } = applicationInfoApi;
