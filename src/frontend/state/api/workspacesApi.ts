// Workspace endpoints, injected into the shared baseApi (Group 8).
import type { Workspace, ApiResponse } from '@shared/types';
import { baseApi } from './baseApi.js';
import { unwrap } from './envelope.js';

export type WorkspacePatch = Partial<
  Pick<Workspace, 'name' | 'currency' | 'timezone' | 'language' | 'autonomyLevel'>
>;

export const workspacesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getWorkspace: builder.query<Workspace, string>({
      query: (id) => `/workspaces/${id}`,
      transformResponse: (res: ApiResponse<Workspace>) => unwrap(res),
    }),

    updateWorkspace: builder.mutation<Workspace, { id: string; patch: WorkspacePatch }>({
      query: ({ id, patch }) => ({ url: `/workspaces/${id}`, method: 'PATCH', body: patch }),
      transformResponse: (res: ApiResponse<Workspace>) => unwrap(res),
    }),
  }),
});

export const { useGetWorkspaceQuery, useUpdateWorkspaceMutation } = workspacesApi;
