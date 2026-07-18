import type { MarketplaceCategoryMetadata } from '../../../../shared/types';

export type CategoryCorrectionOperationKind = 'delist' | 'recreate';
export type CategoryCorrectionOperationState =
  | 'requested'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed';

export interface CategoryCorrectionOperation {
  id: string;
  workspaceId: string;
  recommendationEventId: string | null;
  listingId: string;
  marketplaceId: string;
  kind: CategoryCorrectionOperationKind;
  state: CategoryCorrectionOperationState;
  targetCategory: MarketplaceCategoryMetadata | null;
  paidOverrideReason: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  result: Record<string, unknown> | null;
  requestedAt: Date;
  approvedAt: Date | null;
  executedAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date;
}

export interface ICategoryCorrectionOperationRepository {
  create(operation: CategoryCorrectionOperation): Promise<CategoryCorrectionOperation>;
  createPair(delist: CategoryCorrectionOperation, recreate: CategoryCorrectionOperation): Promise<void>;
  findByIdForWorkspace(id: string, workspaceId: string): Promise<CategoryCorrectionOperation | null>;
  findByRecommendationForWorkspace(
    recommendationEventId: string,
    workspaceId: string,
  ): Promise<CategoryCorrectionOperation[]>;
  approve(input: {
    id: string;
    workspaceId: string;
    actorId: string;
    paidOverrideReason?: string;
    targetCategory?: MarketplaceCategoryMetadata;
    at: Date;
  }): Promise<CategoryCorrectionOperation | null>;
  claimApproved(id: string, workspaceId: string, at: Date): Promise<CategoryCorrectionOperation | null>;
  releaseToApproved(
    id: string,
    workspaceId: string,
    result: Record<string, unknown>,
    at: Date,
  ): Promise<CategoryCorrectionOperation | null>;
  markExecuted(
    id: string,
    workspaceId: string,
    result: Record<string, unknown>,
    at: Date,
  ): Promise<CategoryCorrectionOperation | null>;
  markFailed(
    id: string,
    workspaceId: string,
    result: Record<string, unknown>,
    at: Date,
  ): Promise<CategoryCorrectionOperation | null>;
}
