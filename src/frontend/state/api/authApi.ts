// Auth endpoints, injected into the shared baseApi (Group 8).
// The backend user payload has no `createdAt`; callers map it onto the shared
// `User` type (see authSlice) when dispatching credentials.
import type { ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

export interface AuthUser {
  id: string;
  email: string;
  workspaceId?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<LoginResult, LoginInput>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      transformResponse: (res: ApiResponse<LoginResult>) => unwrap(res),
    }),

    me: builder.query<AuthUser, void>({
      query: () => '/auth/me',
      transformResponse: (res: ApiResponse<AuthUser>) => unwrap(res),
    }),
  }),
});

export const { useLoginMutation, useMeQuery, useLazyMeQuery } = authApi;
