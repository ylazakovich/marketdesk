// Ergonomic re-exports of the RTK Query hooks (Group 8).
// List hooks are thin wrappers that inject the active workspaceId from the
// workspace slice; detail queries and mutations are re-exported verbatim with
// friendlier names. Import these from feature components (Group 9) rather than
// reaching into state/api directly.
import { useAppSelector } from '../../state/hooks.js';
import {
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
  useGetListingsQuery,
  useGetListingQuery,
  usePublishListingPreviewMutation,
  usePublishListingMutation,
  useUpdateListingMutation,
  useRelistListingMutation,
  useGetMarketplacesQuery,
  useGetMarketplaceQuery,
  useGetMarketplaceAppCredentialsQuery,
  useSaveMarketplaceAppCredentialsMutation,
  useSyncMarketplaceMutation,
  useConnectMarketplaceMutation,
  useLazyCheckMarketplaceQuery,
  useImportMarketplacePreviewMutation,
  useImportMarketplaceAdvertsMutation,
  useUpdateMarketplaceMutation,
  useGetHermesEventsQuery,
  useGetHermesEventQuery,
  useApproveHermesEventMutation,
  useDismissHermesEventMutation,
  useExecuteCategoryRecreationOperationMutation,
  useRunHermesMutation,
  useGetAnalyticsOverviewQuery,
  useGetAnalyticsRevenueQuery,
  useGetAnalyticsListingsQuery,
  useGetPriceHistoryQuery,
  useGetWorkspaceQuery,
  useUpdateWorkspaceMutation,
  useLoginMutation,
  useRegisterMutation,
  useMeQuery,
} from '../../state/api/index.js';
import type {
  ProductListParams,
  ListingListParams,
  HermesEventListParams,
  AnalyticsQueryParams,
} from '../../state/api/index.js';

function useWorkspaceId(): string | undefined {
  return useAppSelector((s) => s.workspace.id) ?? undefined;
}

type ProductsOpts = Parameters<typeof useGetProductsQuery>[1];
type ListingsOpts = Parameters<typeof useGetListingsQuery>[1];
type HermesOpts = Parameters<typeof useGetHermesEventsQuery>[1];
type OverviewOpts = Parameters<typeof useGetAnalyticsOverviewQuery>[1];
type RevenueOpts = Parameters<typeof useGetAnalyticsRevenueQuery>[1];
type ListingMetricsOpts = Parameters<typeof useGetAnalyticsListingsQuery>[1];

// ---- Products ----
export function useProducts(params: ProductListParams = {}, options?: ProductsOpts) {
  const workspaceId = useWorkspaceId();
  return useGetProductsQuery({ workspaceId, ...params }, options);
}
export const useProduct = useGetProductQuery;
export const useProductListings = useGetProductListingsQuery;
export const useCreateProduct = useCreateProductMutation;
export const useGenerateProductAIDraft = useGenerateProductAIDraftMutation;
export const useUploadProductImage = useUploadProductImageMutation;
export const useDeleteProductImage = useDeleteProductImageMutation;
export const useUpdateProduct = useUpdateProductMutation;
export const useDeleteProduct = useDeleteProductMutation;
export const useCreateProductListing = useCreateProductListingMutation;

// ---- Listings ----
export function useListings(params: ListingListParams = {}, options?: ListingsOpts) {
  const workspaceId = useWorkspaceId();
  return useGetListingsQuery({ workspaceId, ...params }, options);
}
export const useListing = useGetListingQuery;
export const usePublishListingPreview = usePublishListingPreviewMutation;
export const usePublishListing = usePublishListingMutation;
export const useUpdateListing = useUpdateListingMutation;
export const useRelistListing = useRelistListingMutation;
export const usePriceHistory = useGetPriceHistoryQuery;

// ---- Marketplaces ----
export const useMarketplaces = useGetMarketplacesQuery;
export const useMarketplace = useGetMarketplaceQuery;
export const useMarketplaceAppCredentials = useGetMarketplaceAppCredentialsQuery;
export const useSaveMarketplaceAppCredentials = useSaveMarketplaceAppCredentialsMutation;
export const useSyncMarketplace = useSyncMarketplaceMutation;
export const useConnectMarketplace = useConnectMarketplaceMutation;
export const useCheckMarketplace = useLazyCheckMarketplaceQuery;
export const useImportMarketplacePreview = useImportMarketplacePreviewMutation;
export const useImportMarketplaceAdverts = useImportMarketplaceAdvertsMutation;
export const useUpdateMarketplace = useUpdateMarketplaceMutation;

// ---- Hermes ----
export function useHermesEvents(
  params: HermesEventListParams = {},
  options?: HermesOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetHermesEventsQuery({ workspaceId, ...params }, options);
}
export const useHermesEvent = useGetHermesEventQuery;
export const useApproveHermesEvent = useApproveHermesEventMutation;
export const useDismissHermesEvent = useDismissHermesEventMutation;
export const useExecuteCategoryRecreationOperation = useExecuteCategoryRecreationOperationMutation;
export const useRunHermes = useRunHermesMutation;

// ---- Analytics ----
export function useAnalyticsOverview(
  params: AnalyticsQueryParams = {},
  options?: OverviewOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetAnalyticsOverviewQuery({ workspaceId, ...params }, options);
}
export function useAnalyticsRevenue(
  params: AnalyticsQueryParams = {},
  options?: RevenueOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetAnalyticsRevenueQuery({ workspaceId, ...params }, options);
}
export function useAnalyticsListings(
  params: AnalyticsQueryParams = {},
  options?: ListingMetricsOpts,
) {
  const workspaceId = useWorkspaceId();
  return useGetAnalyticsListingsQuery({ workspaceId, ...params }, options);
}

// ---- Workspace ----
export const useWorkspace = useGetWorkspaceQuery;
export const useUpdateWorkspace = useUpdateWorkspaceMutation;

// ---- Auth ----
export const useLogin = useLoginMutation;
export const useRegister = useRegisterMutation;
export const useMe = useMeQuery;
