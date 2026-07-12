import type { Marketplace } from '../../entities/Marketplace';
import type { MarketplaceKey } from '../../../../shared/types';

export interface IMarketplaceRepository {
  findById(id: string): Promise<Marketplace | null>;
  // Tenant-scoped read. Null when the marketplace belongs to another workspace (S2).
  findByIdForWorkspace(id: string, workspaceId: string): Promise<Marketplace | null>;
  findByWorkspace(workspaceId: string): Promise<Marketplace[]>;
  findConnected(workspaceId: string): Promise<Marketplace[]>;
  findByKey(workspaceId: string, key: MarketplaceKey): Promise<Marketplace | null>;
  save(marketplace: Marketplace): Promise<void>;
  delete(id: string): Promise<void>;
}
