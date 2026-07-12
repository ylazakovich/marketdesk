import { closePool, withTransaction } from '../config/database.js';
import pino from 'pino';

const logger = pino();

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    await withTransaction(async (client) => {
      // Sample workspace (schema per ARCHITECTURE.md §7)
      const workspaceResult = await client.query(
        `INSERT INTO workspaces (name, currency, timezone, autonomy_level)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        ['Demo Workspace', 'PLN', 'Europe/Warsaw', 'suggest_only'],
      );

      const workspaceId = workspaceResult.rows[0].id;
      logger.info({ workspaceId }, 'Created sample workspace');

      // Sample user (v1 auth)
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, workspace_id)
         VALUES ($1, $2, $3) RETURNING id`,
        ['demo@example.com', 'hashed_password', workspaceId],
      );
      logger.info({ userId: userResult.rows[0].id }, 'Created sample user');

      // Sample marketplace
      const marketplaceResult = await client.query(
        `INSERT INTO marketplaces (workspace_id, key, name, connected, sync_mode)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspaceId, 'olx', 'OLX', true, 'hourly'],
      );
      const marketplaceId = marketplaceResult.rows[0].id;
      logger.info({ marketplaceId }, 'Created sample marketplace');

      // Sample products
      const products = [
        {
          sku: 'PROD-001',
          name: 'Sample Product 1',
          costPrice: 15.0,
          sellingPrice: 29.99,
          condition: 'new',
          category: 'electronics',
        },
        {
          sku: 'PROD-002',
          name: 'Sample Product 2',
          costPrice: 25.0,
          sellingPrice: 49.99,
          condition: 'good',
          category: 'home',
        },
        {
          sku: 'PROD-003',
          name: 'Sample Product 3',
          costPrice: 8.0,
          sellingPrice: 19.99,
          condition: 'like_new',
          category: 'clothing',
        },
      ];

      for (const product of products) {
        const result = await client.query(
          `INSERT INTO products
             (workspace_id, sku, name, description, cost_price, selling_price, condition, category, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            workspaceId,
            product.sku,
            product.name,
            `${product.name} is a great item in excellent condition, ready to ship.`,
            product.costPrice,
            product.sellingPrice,
            product.condition,
            product.category,
            'active',
          ],
        );

        const productId = result.rows[0].id;

        // Create a live listing for the product
        await client.query(
          `INSERT INTO listings (product_id, marketplace_id, price, status, published_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
          [productId, marketplaceId, product.sellingPrice, 'live'],
        );
      }

      logger.info('Created sample products and listings');
    });

    logger.info('Database seeding completed successfully');
  } catch (error) {
    logger.error({ error }, 'Seeding failed');
    process.exit(1);
  } finally {
    await closePool();
  }
}

seedDatabase();
