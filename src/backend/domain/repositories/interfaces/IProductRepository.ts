import type { Product } from '../../entities/Product';

export interface IProductRepository {
  findById(id: string): Promise<Product | null>;
  // Tenant-scoped read: returns null when the product belongs to another
  // workspace, so single-resource endpoints cannot leak across tenants (S2).
  findByIdForWorkspace(id: string, workspaceId: string): Promise<Product | null>;
  // Transactional category reconciliation serializes decisions on the product row.
  findByIdForWorkspaceForUpdate(id: string, workspaceId: string): Promise<Product | null>;
  findByWorkspace(workspaceId: string): Promise<Product[]>;
  findBySku(workspaceId: string, sku: string): Promise<Product | null>;
  save(product: Product): Promise<void>;
  saveAll(products: Product[]): Promise<void>;
  // Delete is workspace-scoped so a cross-tenant id cannot delete another
  // tenant's product (S2).
  delete(id: string, workspaceId: string): Promise<void>;
}
