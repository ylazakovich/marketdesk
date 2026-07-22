import { MarketplaceImportService } from '../MarketplaceImportService';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Listing } from '../../../domain/entities/Listing';
import { Product } from '../../../domain/entities/Product';
import type {
  IMarketplaceAdapter,
  ImportedMarketplaceListing,
} from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceAccountRecord } from '../MarketplaceOAuthService';
import {
  InMemoryProductRepository,
  InMemoryListingRepository,
  InMemoryMarketplaceRepository,
  InMemoryEventRepository,
  money,
  unwrap,
} from '../../../domain/testkit/support';
import { InMemoryActivityLogRepository, idFactory } from '../../testkit/support';
import type { MarketplaceCategoryMetadata } from '../../../../shared/types';

const taxonomyNow = Date.now();
const projectorCategory: MarketplaceCategoryMetadata = {
  providerCategoryId: '100', name: 'Projectors', path: ['Electronics', 'Video', 'Projectors'],
  source: 'provider_taxonomy', confidence: 0.98, isLeaf: true,
  taxonomyVerifiedAt: new Date(taxonomyNow - 60_000).toISOString(),
  taxonomyStaleAt: new Date(taxonomyNow + 23 * 60 * 60 * 1000).toISOString(),
};
const headphonesCategory: MarketplaceCategoryMetadata = {
  ...projectorCategory, providerCategoryId: '200', name: 'Wireless headphones',
  path: ['Electronics', 'Audio equipment', 'Headphones', 'Wireless headphones'],
};

const connectedAccount: MarketplaceAccountRecord = {
  id: 'account-1',
  marketplaceId: 'marketplace-1',
  handle: 'seller',
  credentials: {},
  status: 'connected',
  scopes: ['read', 'write'],
  revision: 1,
  createdAt: new Date('2026-07-15T00:00:00.000Z'),
  updatedAt: new Date('2026-07-15T00:00:00.000Z'),
};

function remoteListing(
  overrides: Partial<ImportedMarketplaceListing> = {}
): ImportedMarketplaceListing {
  return {
    externalListingId: 'olx-1',
    externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
    title: 'Remote camera',
    description: 'Existing OLX advert with enough seller supplied detail.',
    price: 100,
    currency: 'PLN',
    status: 'live',
    remoteStatus: 'active',
    category: 'Electronics',
    imageUrls: ['https://img/1.jpg'],
    remoteUpdatedAt: new Date('2026-07-14T00:00:00.000Z'),
    metrics: { views: 7, watchers: 2, messages: 1 },
    ...overrides,
  };
}

function createService(
  remote: ImportedMarketplaceListing[],
  existing: Listing[] = [],
  runUnitOfWork?: ConstructorParameters<typeof MarketplaceImportService>[9],
  productCategorySync?: ConstructorParameters<typeof MarketplaceImportService>[12],
  marketplaceAccount: typeof connectedAccount | null = connectedAccount,
  beforeUnitOfWork?: () => void,
) {
  const marketplace = unwrap(
    Marketplace.create({
      id: 'marketplace-1',
      workspaceId: 'workspace-1',
      key: 'olx',
      name: 'OLX',
      connected: true,
    })
  );
  const marketplaceRepo = new InMemoryMarketplaceRepository();
  marketplaceRepo.items.set(marketplace.id, marketplace);
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  for (const listing of existing) listingRepo.items.set(listing.id, listing);
  const activityLog = new InMemoryActivityLogRepository();
  const eventRepo = new InMemoryEventRepository();
  const correctionOperations = {
    createPair: jest.fn(async () => undefined),
  } as any;
  const adapter = {
    getKey: () => 'olx',
    publish: jest.fn(),
    updateListing: jest.fn(),
    delist: jest.fn(),
    sync: jest.fn(),
    fetchListing: jest.fn(),
    listOwnedListings: jest.fn(async () => remote),
  } as unknown as IMarketplaceAdapter;
  const create = jest.fn(() => adapter);
  let currentMarketplaceAccount = marketplaceAccount;
  const findMarketplaceAccount = jest.fn(async () => currentMarketplaceAccount);
  const accountRepo = {
    findByMarketplaceId: findMarketplaceAccount,
    findByMarketplaceIdForUpdate: findMarketplaceAccount,
  };
  const getValidAccessTokenContext = jest.fn(async () => {
    if (!currentMarketplaceAccount) throw new Error('OLX account is not connected');
    return {
      accessToken: 'access-token',
      account: {
        id: currentMarketplaceAccount.id,
        revision: currentMarketplaceAccount.revision,
      },
    };
  });
  const authenticatedHttpClient = jest.fn(() => ({ request: jest.fn() }));
  const defaultUnitOfWork: ConstructorParameters<typeof MarketplaceImportService>[9] = async (
    work
  ) => {
    beforeUnitOfWork?.();
    return work({
      productRepo,
      listingRepo,
      activityLog,
      eventRepo,
      correctionOperations,
      accountRepo,
    });
  };
  const service = new MarketplaceImportService(
    marketplaceRepo,
    productRepo,
    listingRepo,
    accountRepo as any,
    { create },
    { getValidAccessTokenContext },
    authenticatedHttpClient,
    activityLog,
    idFactory('import'),
    runUnitOfWork ?? defaultUnitOfWork,
    eventRepo,
    correctionOperations,
    productCategorySync,
  );
  return {
    service,
    adapter,
    create,
    getValidAccessToken: getValidAccessTokenContext,
    authenticatedHttpClient,
    productRepo,
    listingRepo,
    activityLog,
    eventRepo,
    correctionOperations,
    accountRepo,
    setMarketplaceAccount: (account: typeof connectedAccount | null) => {
      currentMarketplaceAccount = account;
    },
  };
}

describe('MarketplaceImportService', () => {
  it('builds a read-only preview using account-scoped OLX credentials', async () => {
    const { service, adapter, create, getValidAccessToken, authenticatedHttpClient } =
      createService([remoteListing()]);

    const result = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    if (result.isErr()) throw result.error;
    const preview = result.value;
    expect(getValidAccessToken).toHaveBeenCalledWith('marketplace-1');
    expect(authenticatedHttpClient).toHaveBeenCalledWith('access-token');
    expect(create).toHaveBeenCalledWith('olx', expect.any(Object));
    expect(adapter.listOwnedListings).toHaveBeenCalledWith({
      pageSize: undefined,
      statuses: undefined,
    });
    expect(preview.readOnly).toBe(true);
    expect(preview.totals).toEqual({
      discovered: 1,
      new: 1,
      already_imported: 0,
      changed: 0,
      unsupported: 0,
      failed: 0,
    });
    expect(preview.items[0]).toMatchObject({
      status: 'new',
      externalListingId: 'olx-1',
      title: 'Remote camera',
      warnings: expect.arrayContaining([
        'unknown_cost_price',
        'unknown_condition_requires_confirmation',
      ]),
    });
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(adapter.updateListing).not.toHaveBeenCalled();
    expect(adapter.delist).not.toHaveBeenCalled();
  });

  it('rejects a reconnect that races token resolution before any remote read', async () => {
    const context = createService([remoteListing()]);
    context.getValidAccessToken.mockImplementationOnce(async () => {
      context.setMarketplaceAccount({ ...connectedAccount, revision: 2 });
      return {
        accessToken: 'stale-account-token',
        account: { id: connectedAccount.id, revision: connectedAccount.revision },
      };
    });

    const result = await context.service.preview({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected account fencing failure');
    expect(result.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(result.error.message).toContain('reconciliation is required');
    expect(context.adapter.listOwnedListings).not.toHaveBeenCalled();
  });

  it('rejects an account revision change after remote discovery and before persistence', async () => {
    const context = createService([remoteListing()]);
    (context.adapter.listOwnedListings as jest.Mock).mockImplementationOnce(async () => {
      context.setMarketplaceAccount({ ...connectedAccount, revision: 2 });
      return [remoteListing()];
    });

    const result = await context.service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected account fencing failure');
    expect(result.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(result.error.message).toContain('reconciliation is required');
    expect(context.productRepo.items.size).toBe(0);
    expect(context.correctionOperations.createPair).not.toHaveBeenCalled();
  });

  it('fails an import item when the account changes at the transaction boundary', async () => {
    const context = createService([remoteListing()]);
    context.accountRepo.findByMarketplaceId
      .mockResolvedValueOnce(connectedAccount)
      .mockResolvedValueOnce(connectedAccount)
      .mockResolvedValueOnce({ ...connectedAccount, revision: 2 });

    const result = await context.service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected reconciliation failure');
    expect(result.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(result.error.message).toContain('reconciliation is required');
    expect(context.productRepo.items.size).toBe(0);
    expect(context.correctionOperations.createPair).not.toHaveBeenCalled();
  });

  it('aborts the entire import batch with a typed stale-binding error', async () => {
    const context = createService([
      remoteListing({ externalListingId: 'olx-1' }),
      remoteListing({ externalListingId: 'olx-2', externalUrl: 'https://www.olx.pl/d/oferta/olx-2' }),
    ]);
    context.accountRepo.findByMarketplaceId
      .mockResolvedValueOnce(connectedAccount)
      .mockResolvedValueOnce(connectedAccount)
      .mockResolvedValueOnce({ ...connectedAccount, revision: 2 });

    const result = await context.service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected reconciliation failure');
    expect(result.error.code).toBe('RECONCILIATION_REQUIRED');
    expect(result.error.message).toContain('reconciliation is required');
    expect(context.accountRepo.findByMarketplaceId).toHaveBeenCalledTimes(3);
  });

  it('creates an atomic durable pair for a new mismatched import before a target category is selected', async () => {
    const remote = remoteListing({
      title: 'AOPEN QH11 projector',
      description: 'LED HD 720p HDMI projector in good condition.',
      marketplaceCategory: headphonesCategory,
    });
    const { service, eventRepo, correctionOperations } = createService([remote]);
    const result = await service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
    });
    if (result.isErr()) throw result.error;
    const pending = await eventRepo.findPendingReview('workspace-1');
    expect(pending).toHaveLength(1);
    expect(correctionOperations.createPair).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'delist',
        recommendationEventId: pending[0].id,
        result: expect.objectContaining({
          marketplaceAccountId: 'account-1',
          marketplaceAccountRevision: 1,
        }),
      }),
      expect.objectContaining({ kind: 'recreate', targetCategory: null }),
    );
  });

  it('allows already imported adverts with partial remote data to be refreshed', async () => {
    const existing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: 'product-1',
        marketplaceId: 'marketplace-1',
        marketplaceListingId: 'olx-1',
        price: money(100),
        status: 'live',
      })
    );
    const { service } = createService(
      [remoteListing({ price: null, category: null, imageUrls: [] })],
      [existing]
    );

    const result = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value.totals).toEqual({
      discovered: 1,
      new: 0,
      already_imported: 0,
      changed: 1,
      unsupported: 0,
      failed: 0,
    });
    expect(result.value.items[0]).toMatchObject({
      status: 'changed',
      proposedChanges: expect.arrayContaining(['views']),
    });
    expect(result.value.items[0].warnings).toEqual(
      expect.arrayContaining([
        'missing_price',
        'missing_category_mapping',
        'missing_photos',
        'missing_required_import_fields',
      ])
    );
  });

  it('imports eligible selected adverts locally without provider mutations and records provenance', async () => {
    const { service, productRepo, listingRepo, activityLog, adapter } = createService([
      remoteListing(),
    ]);

    const result = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
      externalListingIds: ['olx-1'],
      actorId: 'user-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value).toMatchObject({ imported: 1, updated: 0, skipped: 0, failed: 0 });
    const products = await productRepo.findByWorkspace('workspace-1');
    expect(products).toHaveLength(1);
    expect(products[0].tags).toEqual(
      expect.arrayContaining(['imported:olx', 'cost-price:unknown'])
    );
    expect(products[0].condition).toBe('unknown');
    const listings = await listingRepo.findByMarketplace('marketplace-1');
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      marketplaceListingId: 'olx-1',
      externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
    });
    expect(listings[0].views).toBe(7);
    expect(listings[0].syncError).toBeNull();
    expect(activityLog.entries[0]).toMatchObject({
      action: 'olx_import_adopted',
      actorType: 'user',
      actorId: 'user-1',
      metadata: expect.objectContaining({
        marketplace: 'olx',
        marketplaceAccountId: 'account-1',
        externalListingId: 'olx-1',
        readOnlyProviderOperation: true,
      }),
    });
    expect(adapter.publish).not.toHaveBeenCalled();
    expect(adapter.updateListing).not.toHaveBeenCalled();
    expect(adapter.delist).not.toHaveBeenCalled();
  });

  it('treats omitted selection as import all and explicit empty selection as import none', async () => {
    const { service, productRepo } = createService([remoteListing()]);

    const emptySelection = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
      externalListingIds: [],
    });

    if (emptySelection.isErr()) throw emptySelection.error;
    expect(emptySelection.value).toMatchObject({ imported: 0, updated: 0, skipped: 0, failed: 0 });
    expect(await productRepo.findByWorkspace('workspace-1')).toHaveLength(0);

    const omittedSelection = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    if (omittedSelection.isErr()) throw omittedSelection.error;
    expect(omittedSelection.value).toMatchObject({
      imported: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('flags duplicate remote identities as failed preview items', async () => {
    const { service } = createService([
      remoteListing({ externalListingId: 'dup' }),
      remoteListing({ externalListingId: 'dup', title: 'Duplicate camera' }),
    ]);

    const result = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value.totals.failed).toBe(2);
    expect(result.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalListingId: 'dup',
          status: 'failed',
          warnings: expect.arrayContaining(['duplicate_remote_external_listing_id']),
        }),
      ])
    );
  });

  it('refreshes changed listing and product fields with account provenance', async () => {
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'workspace-1',
        sku: 'SKU-1',
        name: 'Old camera',
        description: 'Old imported description with enough detail.',
        costPrice: money(10),
        sellingPrice: money(80),
        condition: 'good',
        category: 'Old category',
        status: 'active',
        images: ['https://img/old.jpg'],
      })
    );
    const existing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: 'marketplace-1',
        marketplaceListingId: 'olx-1',
        price: money(80),
        status: 'draft',
      })
    );
    const { service, productRepo, listingRepo, activityLog } = createService(
      [remoteListing()],
      [existing]
    );
    productRepo.items.set(product.id, product);

    const preview = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });
    if (preview.isErr()) throw preview.error;
    expect(preview.value.items[0]).toMatchObject({
      status: 'changed',
      proposedChanges: expect.arrayContaining([
        'price',
        'status',
        'product_title',
        'product_description',
        'product_images',
        'product_selling_price',
      ]),
    });

    const result = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
      externalListingIds: ['olx-1'],
      actorId: 'user-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value).toMatchObject({ imported: 0, updated: 1, skipped: 0, failed: 0 });
    expect(productRepo.items.get(product.id)).toMatchObject({
      name: 'Remote camera',
      description: 'Existing OLX advert with enough seller supplied detail.',
      category: 'Old category',
    });
    expect(productRepo.items.get(product.id)?.sellingPrice.amount).toBe(100);
    expect(productRepo.items.get(product.id)?.images).toEqual(['https://img/1.jpg']);
    expect(listingRepo.items.get(existing.id)).toMatchObject({ status: 'live' });
    expect(listingRepo.items.get(existing.id)?.syncError).toBeNull();
    expect(activityLog.entries[0]).toMatchObject({
      action: 'olx_import_refreshed',
      metadata: expect.objectContaining({ marketplaceAccountId: 'account-1' }),
    });
  });

  it('preserves imported exact remote category metadata', async () => {
    const remote = remoteListing({ marketplaceCategory: headphonesCategory });
    const { service, listingRepo } = createService([remote]);

    const result = await service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
    });

    if (result.isErr()) throw result.error;
    const [listing] = await listingRepo.findByMarketplace('marketplace-1');
    expect(listing.marketplaceCategory).toEqual(headphonesCategory);
    expect(listing.status).toBe('live');
  });

  it('preserves trusted listing category evidence when OLX omits category metadata', async () => {
    const existing = unwrap(Listing.create({
      id: 'listing-category-preserve', productId: 'product-1', marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1', externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
      price: money(100), status: 'live', remoteStatus: 'active',
      marketplaceCategory: headphonesCategory, views: 7, watchers: 2, messages: 1,
    }));
    const { service, listingRepo } = createService([
      remoteListing({ marketplaceCategory: null }),
    ], [existing]);

    const result = await service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
    });

    if (result.isErr()) throw result.error;
    expect((await listingRepo.findById(existing.id))?.marketplaceCategory).toEqual(headphonesCategory);
  });

  it('detects refreshed trust metadata even when the category identity is unchanged', async () => {
    const existingCategory = { ...headphonesCategory, taxonomyVerifiedAt: '2026-01-10T11:00:00.000Z' };
    const refreshedCategory = { ...headphonesCategory, taxonomyVerifiedAt: '2026-01-10T12:00:00.000Z' };
    const existing = unwrap(Listing.create({
      id: 'listing-trust-refresh', productId: 'product-1', marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1', price: money(100), status: 'live',
      marketplaceCategory: existingCategory,
    }));
    const { service } = createService([
      remoteListing({ marketplaceCategory: refreshedCategory }),
    ], [existing]);

    const preview = await service.preview({ workspaceId: 'workspace-1', marketplaceId: 'marketplace-1' });
    if (preview.isErr()) throw preview.error;

    expect(preview.value.items[0]).toMatchObject({
      status: 'changed',
      proposedChanges: expect.arrayContaining(['marketplace_category']),
    });
  });

  it('reconciles a stale product category even when the imported listing itself is unchanged', async () => {
    const product = unwrap(Product.create({
      id: 'product-projector-import', workspaceId: 'workspace-1', sku: 'PROJECTOR-IMPORT',
      name: 'Remote camera', description: 'Existing OLX advert with enough seller supplied detail.',
      costPrice: money(10), sellingPrice: money(100), condition: 'good',
      category: 'Electronics', status: 'active', images: ['https://img/1.jpg'],
    }));
    const existing = unwrap(Listing.create({
      id: 'listing-projector-import', productId: product.id, marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1', externalUrl: 'https://www.olx.pl/d/oferta/olx-1',
      price: money(100), status: 'live', marketplaceCategory: projectorCategory,
      views: 7, watchers: 2, messages: 1,
    }));
    const reconcileWithRepositories = jest.fn(async () => ({ outcome: 'synced', categoryChanged: true }));
    const created = createService(
      [remoteListing({ marketplaceCategory: projectorCategory })],
      [existing],
      undefined,
      { reconcileWithRepositories } as any,
    );
    created.productRepo.items.set(product.id, product);

    const preview = await created.service.preview({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1',
    });
    if (preview.isErr()) throw preview.error;
    expect(preview.value.items[0]).toMatchObject({
      status: 'changed', proposedChanges: expect.arrayContaining(['product_category']),
    });

    const result = await created.service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
      actorId: 'user-1',
    });
    if (result.isErr()) throw result.error;
    expect(result.value).toMatchObject({ updated: 1, skipped: 0, failed: 0 });
    expect(reconcileWithRepositories).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1', listingId: 'listing-projector-import',
        trigger: 'import', actorId: 'user-1',
      }),
      expect.objectContaining({
        productRepo: created.productRepo,
        listingRepo: created.listingRepo,
      }),
    );
  });

  it('creates one idempotent pending-review mismatch recommendation with separate fail-closed intents', async () => {
    const product = unwrap(Product.create({
      id: 'product-projector', workspaceId: 'workspace-1', sku: 'PROJECTOR-1',
      name: 'AOPEN QH11 projector', description: 'LED HD 720p HDMI projector in good condition.',
      costPrice: money(10), sellingPrice: money(100), condition: 'good', category: 'Electronics',
    }));
    const existing = unwrap(Listing.create({
      id: 'listing-projector', productId: product.id, marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-1', price: money(100), status: 'live',
      marketplaceCategory: projectorCategory,
    }));
    const remote = remoteListing({
      title: 'AOPEN QH11 projector',
      description: 'LED HD 720p HDMI projector in good condition.',
      marketplaceCategory: headphonesCategory,
    });
    const { service, productRepo, eventRepo, adapter, correctionOperations } = createService([remote], [existing]);
    productRepo.items.set(product.id, product);

    const first = await service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
    });
    if (first.isErr()) throw first.error;
    const replay = await service.import({
      workspaceId: 'workspace-1', marketplaceId: 'marketplace-1', externalListingIds: ['olx-1'],
    });
    if (replay.isErr()) throw replay.error;

    const pending = await eventRepo.findPendingReview('workspace-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: 'olx_category_mismatch', status: 'pending_review' });
    expect(pending[0].proposedChange).toEqual(expect.objectContaining({
      kind: 'category_recreation', listingId: 'listing-projector',
      currentCategory: headphonesCategory, proposedCategory: projectorCategory,
      operations: [
        expect.objectContaining({ kind: 'delist', status: 'pending_review', providerSideEffectAllowed: false, quotaUnitsRestored: 0 }),
        expect.objectContaining({ kind: 'recreate', status: 'blocked_pending_quota_review', providerSideEffectAllowed: false, quotaGuardRequired: true }),
      ],
    }));
    expect(correctionOperations.createPair).toHaveBeenCalledTimes(1);
    expect(correctionOperations.createPair).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'delist', recommendationEventId: pending[0].id }),
      expect.objectContaining({ kind: 'recreate', targetCategory: projectorCategory }),
    );
    expect(adapter.delist).not.toHaveBeenCalled();
    expect(adapter.publish).not.toHaveBeenCalled();
  });

  it('fails closed when synchronization has no executable account binding', async () => {
    const product = unwrap(Product.create({
      id: 'product-disconnected', workspaceId: 'workspace-1', sku: 'DISCONNECTED-1',
      name: 'Disconnected listing', description: 'Existing synchronized listing.',
      costPrice: money(10), sellingPrice: money(100), condition: 'good', category: 'Electronics',
    }));
    const listing = unwrap(Listing.create({
      id: 'listing-disconnected', productId: product.id, marketplaceId: 'marketplace-1',
      marketplaceListingId: 'olx-disconnected', price: money(100), status: 'live',
      marketplaceCategory: headphonesCategory,
    }));
    const { service, productRepo, correctionOperations } = createService(
      [], [listing], undefined, undefined, null,
    );
    productRepo.items.set(product.id, product);

    await expect(service.recommendSyncedCategoryMismatch({
      listing,
      workspaceId: 'workspace-1',
      currentCategory: headphonesCategory,
      proposedCategory: projectorCategory,
      marketplaceAccount: { id: connectedAccount.id, revision: connectedAccount.revision },
    })).rejects.toThrow('reconciliation is required');
    expect(correctionOperations.createPair).not.toHaveBeenCalled();
  });

  it('returns item-level failed preview entries for unmappable discovered adverts', async () => {
    const { service } = createService([
      remoteListing(),
      { ...remoteListing({ externalListingId: '' }), title: '' },
    ]);

    const result = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    if (result.isErr()) throw result.error;
    expect(result.value.totals).toMatchObject({ discovered: 2, new: 1, failed: 1 });
    expect(result.value.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'failed',
          externalListingId: 'unmapped-2',
          warnings: expect.arrayContaining(['item_mapping_failed']),
        }),
      ])
    );
  });

  it('returns Result.Err when access token refresh fails', async () => {
    const { service, getValidAccessToken } = createService([remoteListing()]);
    getValidAccessToken.mockRejectedValueOnce(new Error('refresh failed'));

    const result = await service.preview({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe('refresh failed');
  });

  it('does not revive sold products from imported live status updates', async () => {
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'workspace-1',
        sku: 'SKU-1',
        name: 'Sold camera',
        description: 'Sold imported description with enough detail.',
        costPrice: money(10),
        sellingPrice: money(80),
        condition: 'good',
        category: 'Electronics',
        status: 'active',
      })
    );
    const sold = product.transitionTo('sold');
    if (sold.isErr()) throw sold.error;
    const existing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: 'marketplace-1',
        marketplaceListingId: 'olx-1',
        price: money(100),
        status: 'draft',
      })
    );
    const { service, productRepo, listingRepo } = createService([remoteListing()], [existing]);
    productRepo.items.set(product.id, product);

    const result = await service.import({
      workspaceId: 'workspace-1',
      marketplaceId: 'marketplace-1',
      externalListingIds: ['olx-1'],
    });

    if (result.isErr()) throw result.error;
    expect(result.value).toMatchObject({ imported: 0, updated: 0, skipped: 0, failed: 1 });
    expect(listingRepo.items.get(existing.id)?.status).toBe('draft');
    expect(productRepo.items.get(product.id)).toMatchObject({
      status: 'sold',
      name: 'Sold camera',
      description: 'Sold imported description with enough detail.',
      category: 'Electronics',
    });
    expect(productRepo.items.get(product.id)?.sellingPrice.amount).toBe(80);
  });
});
