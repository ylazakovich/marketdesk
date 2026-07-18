// Integration tests for the PostgreSQL repositories.
//
// These require a reachable database. They run only when DATABASE_URL is set
// AND the connection succeeds; otherwise the whole suite is skipped cleanly so
// `npx jest` stays green in environments without Postgres.
//
// NOTE: modules are loaded lazily (dynamic import) inside beforeAll so that the
// config/database module graph is never evaluated unless we actually intend to
// hit a database.

import type { Pool } from 'pg';
import { randomUUID } from 'crypto';

// Type-only imports are erased at compile time; they add no runtime require.
import type { ProductRepository as ProductRepositoryType } from '../repositories/ProductRepository';
import type { WorkspaceRepository as WorkspaceRepositoryType } from '../repositories/WorkspaceRepository';
import type { MarketplaceRepository as MarketplaceRepositoryType } from '../repositories/MarketplaceRepository';
import type { ListingRepository as ListingRepositoryType } from '../repositories/ListingRepository';
import type { EventRepository as EventRepositoryType } from '../repositories/EventRepository';
import type { ActivityLogRepository as ActivityLogRepositoryType } from '../repositories/ActivityLogRepository';
import type { Product as ProductType } from '../../../domain/entities/Product';
import type { Marketplace as MarketplaceType } from '../../../domain/entities/Marketplace';
import type { Listing as ListingType } from '../../../domain/entities/Listing';
import type { Money as MoneyValue } from '../../../domain/valueObjects/Money';

const hasDbUrl = Boolean(process.env.DATABASE_URL);
const requireDatabaseTests = process.env.REQUIRE_DATABASE_TESTS === 'true';
const describeDb = hasDbUrl || requireDatabaseTests ? describe : describe.skip;

describeDb('PostgreSQL repositories (integration)', () => {
  let ready = false;
  let pool: Pool;
  let closePool: () => Promise<void>;

  let ProductRepository: typeof ProductRepositoryType;
  let WorkspaceRepository: typeof WorkspaceRepositoryType;
  let MarketplaceRepository: typeof MarketplaceRepositoryType;
  let ListingRepository: typeof ListingRepositoryType;
  let EventRepository: typeof EventRepositoryType;
  let ActivityLogRepository: typeof ActivityLogRepositoryType;
  let Product: typeof ProductType;
  let Marketplace: typeof MarketplaceType;
  let Listing: typeof ListingType;
  let Money: typeof import('../../../domain/valueObjects/Money').Money;

  const workspaceId = randomUUID();

  beforeAll(async () => {
    try {
      if (!hasDbUrl) throw new Error('DATABASE_URL is required for database integration tests');
      const db = await import('../../../config/database');
      pool = await db.getPool();
      closePool = db.closePool;
      await pool.query('SELECT 1');

      ({ ProductRepository } = await import('../repositories/ProductRepository'));
      ({ WorkspaceRepository } = await import('../repositories/WorkspaceRepository'));
      ({ MarketplaceRepository } = await import('../repositories/MarketplaceRepository'));
      ({ ListingRepository } = await import('../repositories/ListingRepository'));
      ({ EventRepository } = await import('../repositories/EventRepository'));
      ({ ActivityLogRepository } = await import('../repositories/ActivityLogRepository'));
      ({ Product } = await import('../../../domain/entities/Product'));
      ({ Marketplace } = await import('../../../domain/entities/Marketplace'));
      ({ Listing } = await import('../../../domain/entities/Listing'));
      ({ Money } = await import('../../../domain/valueObjects/Money'));

      // Baseline workspace all other rows hang off.
      await new WorkspaceRepository().save(
        unwrap(
          (await import('../../../domain/entities/Workspace')).Workspace.create({
            id: workspaceId,
            name: 'IT Workspace',
            currency: 'PLN',
          })
        )
      );
      ready = true;
    } catch (err) {
      if (requireDatabaseTests) throw err;
      // eslint-disable-next-line no-console
      console.warn(
        `[repositories.integration] Database unreachable — skipping integration tests. ${
          (err as Error).message
        }`
      );
      ready = false;
    }
  });

  afterAll(async () => {
    if (ready) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await closePool();
    }
  });

  function unwrap<T>(r: { isErr(): boolean; value?: T; error?: unknown }): T {
    if (r.isErr()) throw r.error;
    return r.value as T;
  }

  function money(amount: number): MoneyValue {
    return unwrap(Money.of(amount, 'PLN'));
  }

  function skipIfNotReady(): boolean {
    if (!ready) {
      if (requireDatabaseTests)
        throw new Error('Required PostgreSQL repository suite is not ready');
      // eslint-disable-next-line no-console
      console.warn('[repositories.integration] skipped (no DB)');
    }
    return !ready;
  }

  it('round-trips a Product aggregate with tags and images', async () => {
    if (skipIfNotReady()) return;
    const repo = new ProductRepository();
    const id = randomUUID();
    const product: ProductType = unwrap(
      Product.create({
        id,
        workspaceId,
        sku: `SKU-${id.slice(0, 8)}`,
        name: 'Integration Widget',
        description: 'A perfectly reasonable description over twenty chars.',
        costPrice: money(15),
        sellingPrice: money(29.99),
        condition: 'new',
        category: 'electronics',
        tags: ['a', 'b'],
        images: ['https://img/1.jpg', 'https://img/2.jpg'],
      })
    );

    await repo.save(product);
    const loaded = await repo.findById(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.sellingPrice.amount).toBe(29.99);
    expect([...loaded!.tags].sort()).toEqual(['a', 'b']);
    expect([...loaded!.images]).toEqual(['https://img/1.jpg', 'https://img/2.jpg']);

    const bySku = await repo.findBySku(workspaceId, product.sku);
    expect(bySku?.id).toBe(id);

    // Workspace-scoped read: own workspace sees it, another does not (S2).
    expect((await repo.findByIdForWorkspace(id, workspaceId))?.id).toBe(id);
    expect(await repo.findByIdForWorkspace(id, randomUUID())).toBeNull();

    // Delete scoped to a foreign workspace is a no-op; the correct workspace deletes.
    await repo.delete(id, randomUUID());
    expect(await repo.findById(id)).not.toBeNull();
    await repo.delete(id, workspaceId);
    expect(await repo.findById(id)).toBeNull();
  });

  it('round-trips a Marketplace and Listing, and finds expiring listings', async () => {
    if (skipIfNotReady()) return;
    const mktRepo = new MarketplaceRepository();
    const productRepo = new ProductRepository();
    const listingRepo = new ListingRepository();

    const mktId = randomUUID();
    const mkt: MarketplaceType = unwrap(
      Marketplace.create({
        id: mktId,
        workspaceId,
        key: 'olx',
        name: 'OLX',
        connected: true,
        syncMode: 'hourly',
      })
    );
    await mktRepo.save(mkt);
    expect((await mktRepo.findConnected(workspaceId)).some((m) => m.id === mktId)).toBe(true);
    expect((await mktRepo.findByKey(workspaceId, 'olx'))?.id).toBe(mktId);

    const productId = randomUUID();
    await productRepo.save(
      unwrap(
        Product.create({
          id: productId,
          workspaceId,
          sku: `SKU-${productId.slice(0, 8)}`,
          name: 'Listable',
          description: 'A perfectly reasonable description over twenty chars.',
          costPrice: money(10),
          sellingPrice: money(40),
          condition: 'good',
          category: 'home',
        })
      )
    );

    const listingId = randomUUID();
    const listing: ListingType = unwrap(
      Listing.create({
        id: listingId,
        productId,
        marketplaceId: mktId,
        price: money(40),
        status: 'live',
        expiresAt: new Date(Date.now() + 60_000),
        publishedAt: new Date(),
      })
    );
    await listingRepo.save(listing);

    expect((await listingRepo.findByProduct(productId)).length).toBe(1);
    expect((await listingRepo.findByMarketplace(mktId)).length).toBe(1);
    expect((await listingRepo.findByWorkspace(workspaceId)).some((l) => l.id === listingId)).toBe(
      true
    );
    const expiring = await listingRepo.findExpiring(new Date(Date.now() + 120_000));
    expect(expiring.some((l) => l.id === listingId)).toBe(true);

    // Workspace-scoped listing read (listing -> product -> workspace) (S2).
    expect((await listingRepo.findByIdForWorkspace(listingId, workspaceId))?.id).toBe(listingId);
    expect(await listingRepo.findByIdForWorkspace(listingId, randomUUID())).toBeNull();
    // Workspace-scoped marketplace read (S2).
    expect((await mktRepo.findByIdForWorkspace(mktId, workspaceId))?.id).toBe(mktId);
    expect(await mktRepo.findByIdForWorkspace(mktId, randomUUID())).toBeNull();

    await productRepo.delete(productId, workspaceId); // cascades listing
    await mktRepo.delete(mktId);
  });

  it('persists Hermes events and queries pending review', async () => {
    if (skipIfNotReady()) return;
    const repo = new EventRepository();
    const id = randomUUID();
    const { HermesEvent } = await import('../../../domain/entities/HermesEvent');
    const event = unwrap(
      HermesEvent.create({
        id,
        workspaceId,
        type: 'suggested_lower_price',
        severity: 'warning',
        title: 'Lower price',
        proposedChange: { kind: 'price', field: 'price', from: 100, to: 80 },
      })
    );
    await repo.save(event);
    const pending = await repo.findPendingReview(workspaceId);
    expect(pending.some((e) => e.id === id)).toBe(true);
    const loaded = await repo.findById(id);
    expect(loaded?.proposedChange).toEqual({
      kind: 'price',
      field: 'price',
      from: 100,
      to: 80,
    });
    await repo.deleteOlderThan(new Date(Date.now() + 60_000));
    expect(await repo.findById(id)).toBeNull();
  });

  it('records activity log entries (append-only)', async () => {
    if (skipIfNotReady()) return;
    const repo = new ActivityLogRepository();
    const entityId = randomUUID();
    await repo.record({
      id: randomUUID(),
      workspaceId,
      entityType: 'product',
      entityId,
      actorType: 'hermes',
      action: 'price_updated',
      metadata: { from: 100, to: 80 },
      createdAt: new Date(),
    });
    const byEntity = await repo.findByEntity('product', entityId);
    expect(byEntity.length).toBe(1);
    expect(byEntity[0].metadata).toEqual({ from: 100, to: 80 });
    const byWorkspace = await repo.findByWorkspace(workspaceId);
    expect(byWorkspace.length).toBeGreaterThanOrEqual(1);
  });
});
