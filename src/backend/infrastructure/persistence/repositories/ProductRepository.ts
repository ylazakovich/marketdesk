import type { PoolClient, Pool } from 'pg';
import { query, withTransaction } from '../../../config/database';
import type { IProductRepository } from '../../../domain/repositories/interfaces/IProductRepository';
import type { Product } from '../../../domain/entities/Product';
import { ProductMapper } from '../mappers/ProductMapper';
import type { ProductImageRow, ProductRow, ProductTagRow } from '../mappers/rows';

// products carry no currency column; join workspaces to reconstruct Money.
const PRODUCT_SELECT = `
  SELECT p.id, p.workspace_id, p.sku, p.name, p.description,
         p.cost_price, p.selling_price, p.condition, p.category, p.category_provenance, p.status,
         p.created_at, p.updated_at, w.currency
  FROM products p
  JOIN workspaces w ON w.id = p.workspace_id
`;

export class ProductRepository implements IProductRepository {
  // An optional pool for test injection, or client for enlisting in a
  // transaction; if neither provided, the module-level pool is used.
  private readonly pool?: Pool;
  private readonly client?: PoolClient;
  private readonly queryClient?: PoolClient | Pool;

  constructor(pool?: Pool, client?: PoolClient) {
    this.pool = pool;
    this.client = client;
    this.queryClient = client || pool;
  }

  async findById(id: string): Promise<Product | null> {
    const { rows } = await query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.id = $1`,
      [id],
      this.queryClient
    );
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  async findByIdForWorkspace(id: string, workspaceId: string): Promise<Product | null> {
    const { rows } = await query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.id = $1 AND p.workspace_id = $2`,
      [id, workspaceId],
      this.queryClient
    );
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  async findByIdForWorkspaceForUpdate(id: string, workspaceId: string): Promise<Product | null> {
    if (!this.client) {
      throw new Error('Product row locking requires an enlisted transaction client');
    }
    const { rows } = await query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.id = $1 AND p.workspace_id = $2 FOR UPDATE OF p`,
      [id, workspaceId],
      this.client,
    );
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<Product[]> {
    const { rows } = await query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.workspace_id = $1 ORDER BY p.created_at DESC`,
      [workspaceId],
      this.queryClient
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async findBySku(workspaceId: string, sku: string): Promise<Product | null> {
    const { rows } = await query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.workspace_id = $1 AND p.sku = $2`,
      [workspaceId, sku],
      this.queryClient
    );
    const row = rows[0];
    return row ? this.hydrate(row) : null;
  }

  async save(product: Product): Promise<void> {
    await this.runInTransaction((client) => this.persist(product, client));
  }

  async saveAll(products: Product[]): Promise<void> {
    await this.runInTransaction(async (client) => {
      for (const product of products) {
        await this.persist(product, client);
      }
    });
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    // ON DELETE CASCADE removes tags, images and listings. Scoped by workspace
    // so a cross-tenant id is a no-op rather than a cross-tenant delete (S2).
    await query(
      `DELETE FROM products WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
      this.queryClient
    );
  }

  private async hydrate(row: ProductRow): Promise<Product> {
    const [tags, images] = await Promise.all([
      query<ProductTagRow>(
        `SELECT tag FROM product_tags WHERE product_id = $1`,
        [row.id],
        this.queryClient
      ),
      query<ProductImageRow>(
        `SELECT url, position FROM product_images WHERE product_id = $1 ORDER BY position ASC`,
        [row.id],
        this.queryClient
      ),
    ]);
    return ProductMapper.toDomain(row, tags.rows, images.rows);
  }

  private async persist(product: Product, client: PoolClient): Promise<void> {
    await query(
      `INSERT INTO products
         (id, workspace_id, sku, name, description, cost_price, selling_price,
          condition, category, category_provenance, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         cost_price = EXCLUDED.cost_price,
         selling_price = EXCLUDED.selling_price,
         condition = EXCLUDED.condition,
         category = EXCLUDED.category,
         category_provenance = EXCLUDED.category_provenance,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [
        product.id,
        product.workspaceId,
        product.sku,
        product.name,
        product.description,
        product.costPrice?.amount ?? null,
        product.sellingPrice.amount,
        product.condition,
        product.category,
        product.categoryProvenance ? JSON.stringify(product.categoryProvenance) : null,
        product.status,
        product.createdAt,
        product.updatedAt,
      ],
      client
    );

    // Child collections are replaced wholesale to keep the aggregate in sync.
    await query(`DELETE FROM product_tags WHERE product_id = $1`, [product.id], client);
    for (const tag of product.tags) {
      await query(
        `INSERT INTO product_tags (product_id, tag) VALUES ($1, $2)`,
        [product.id, tag],
        client
      );
    }

    await query(`DELETE FROM product_images WHERE product_id = $1`, [product.id], client);
    let position = 0;
    for (const url of product.images) {
      await query(
        `INSERT INTO product_images (product_id, url, position) VALUES ($1, $2, $3)`,
        [product.id, url, position],
        client
      );
      position += 1;
    }
  }

  private async runInTransaction(fn: (client: PoolClient) => Promise<void>): Promise<void> {
    if (this.client) {
      await fn(this.client);
      return;
    }
    await withTransaction(fn);
  }
}
