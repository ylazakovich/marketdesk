import { UpdateProductUseCase } from '../usecases/UpdateProductUseCase';
import {
  InMemoryProductRepository,
  RecordingEventPublisher,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Product } from '../../domain/entities/Product';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const publisher = new RecordingEventPublisher();
  const useCase = new UpdateProductUseCase(productRepo, publisher);
  const product = unwrap(
    Product.create({
      id: 'prod-1',
      workspaceId: 'ws-1',
      sku: 'AIRPODS4-PL-001',
      name: 'AirPods 4',
      description: 'AirPods in good condition with all required details.',
      costPrice: money(649),
      sellingPrice: money(799),
      condition: 'good',
      category: 'electronics',
    }),
  );
  productRepo.items.set(product.id, product);
  return { useCase, productRepo, publisher, product };
}

describe('UpdateProductUseCase', () => {
  it('requires and audits confirmation for an intentional below-cost update', async () => {
    const { useCase, productRepo, publisher, product } = setup();

    const rejected = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      sellingPrice: 399,
    });
    expect(rejected.isErr()).toBe(true);

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      sellingPrice: 399,
      allowBelowCost: true,
    });

    expect(result.isOk()).toBe(true);
    const updated = unwrap(result);
    expect(updated.sellingPrice.amount).toBe(399);
    expect(productRepo.items.get(product.id)?.sellingPrice.amount).toBe(399);
    expect(publisher.published.map((event) => event.type)).toContain('product.updated');
    expect(publisher.published.at(-1)?.payload.pricingDecision).toMatchObject({
      belowCost: true,
      confirmed: true,
      before: { costPrice: 649, sellingPrice: 799 },
      after: { costPrice: 649, sellingPrice: 399 },
    });
  });

  it('updates editable product details including cost price, condition and category', async () => {
    const { useCase, productRepo, publisher, product } = setup();

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 599,
      sellingPrice: 749,
      condition: 'like_new',
      category: 'audio',
    });

    expect(result.isOk()).toBe(true);
    const updated = unwrap(result);
    expect(updated.costPrice.amount).toBe(599);
    expect(updated.sellingPrice.amount).toBe(749);
    expect(updated.condition).toBe('like_new');
    expect(updated.category).toBe('audio');
    expect(productRepo.items.get(product.id)?.costPrice.amount).toBe(599);
    expect(productRepo.saved[0]?.costPrice.amount).toBe(599);
    expect(productRepo.saved[0]?.category).toBe('audio');
    expect(publisher.published.map((event) => event.type)).toContain('product.updated');
  });

  it('persists a cost-price-only update through the repository boundary', async () => {
    const { useCase, productRepo, product } = setup();

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 699,
    });

    expect(result.isOk()).toBe(true);
    expect(productRepo.saved).toHaveLength(1);
    expect(productRepo.saved[0]?.costPrice.amount).toBe(699);
    expect(productRepo.saved[0]?.sellingPrice.amount).toBe(799);
  });

  it('checks a cost-only partial update against the persisted selling price', async () => {
    const { useCase, productRepo, product } = setup();

    const rejected = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 899,
    });
    expect(rejected.isErr()).toBe(true);
    expect(product.costPrice?.amount).toBe(649);

    const accepted = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 899,
      allowBelowCost: true,
    });
    expect(accepted.isOk()).toBe(true);
    expect(productRepo.saved.at(-1)?.costPrice?.amount).toBe(899);
  });

  it('allows unrelated edits to an existing confirmed below-cost product', async () => {
    const { useCase, publisher, product } = setup();
    expect(product.updateSellingPrice(money(399), true).isOk()).toBe(true);

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      name: 'AirPods 4 clearance',
    });

    expect(result.isOk()).toBe(true);
    expect(product.name).toBe('AirPods 4 clearance');
    expect(publisher.published.at(-1)?.payload.pricingDecision).toBeUndefined();
  });

  it('applies simultaneous cost and selling price increases without transient invariant failure', async () => {
    const { useCase, productRepo, product } = setup();

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 899,
      sellingPrice: 999,
    });

    expect(result.isOk()).toBe(true);
    expect(productRepo.saved[0]?.costPrice.amount).toBe(899);
    expect(productRepo.saved[0]?.sellingPrice.amount).toBe(999);
  });

  it('applies simultaneous price decreases when selling drops below the old cost', async () => {
    const { useCase, productRepo, product } = setup();

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      costPrice: 549,
      sellingPrice: 599,
    });

    expect(result.isOk()).toBe(true);
    expect(productRepo.saved[0]?.costPrice.amount).toBe(549);
    expect(productRepo.saved[0]?.sellingPrice.amount).toBe(599);
  });

  it('uses a transaction-scoped locked re-read before applying an ordinary update', async () => {
    const { productRepo, publisher, product } = setup();
    const locked = jest.spyOn(productRepo, 'findByIdForWorkspaceForUpdate');
    const runInTransaction = jest.fn(async <T>(work: (repo: InMemoryProductRepository) => Promise<T>) => {
      const result = await work(productRepo);
      expect(publisher.published).toHaveLength(0);
      return result;
    });
    const useCase = new UpdateProductUseCase(productRepo, publisher, runInTransaction);

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      name: 'AirPods 4 updated safely',
    });

    expect(result.isOk()).toBe(true);
    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(locked).toHaveBeenCalledWith(product.id, product.workspaceId);
  });

});
