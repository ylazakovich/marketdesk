import type {
  OlxPublicationQuota,
  OlxQuotaDecisionKind,
  OlxQuotaStatus,
} from '../../entities/OlxPublicationQuota';

export interface OlxQuotaLookup {
  workspaceId: string;
  marketplaceId: string;
  marketplaceAccountId: string;
  subcategoryId: string;
  at: Date;
}

export interface AuthorizeOlxPublicationInput extends OlxQuotaLookup {
  operationId: string;
  listingId: string;
  mode: 'publish' | 'relist';
  overrideConfirmed: boolean;
  overrideReason?: string;
  actorId?: string;
}

export interface OlxPublicationAuthorization {
  operationId: string;
  decision: OlxQuotaDecisionKind;
  status: OlxQuotaStatus;
  reason: string;
  quota: OlxPublicationQuota | null;
  consumedUnit: boolean;
  replayed: boolean;
}

export interface IOlxPublicationQuotaRepository {
  findCurrent(input: OlxQuotaLookup): Promise<OlxPublicationQuota | null>;
  findByAccount(input: {
    workspaceId: string;
    marketplaceId: string;
    marketplaceAccountId: string;
    limit: number;
  }): Promise<OlxPublicationQuota[]>;
  save(quota: OlxPublicationQuota): Promise<void>;
  authorize(input: AuthorizeOlxPublicationInput): Promise<OlxPublicationAuthorization>;
}
