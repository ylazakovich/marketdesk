// Input DTOs for Hermes orchestration.

import type { HermesEventStatus, HermesSeverity } from '../../../shared/types';

export interface RunHermesDTO {
  workspaceId: string;
  trigger?: 'scheduled' | 'manual' | 'event';
}

export interface SyncMarketplaceDTO {
  marketplaceId: string;
  workspaceId?: string;
  actorId?: string;
}

export interface ListEventsQueryDTO {
  workspaceId: string;
  // Multi-value filters: the HTTP layer parses comma-separated query params
  // (e.g. ?status=pending_review,applied&severity=warning,critical).
  status?: HermesEventStatus[];
  severity?: HermesSeverity[];
  limit?: number;
  offset?: number;
}
