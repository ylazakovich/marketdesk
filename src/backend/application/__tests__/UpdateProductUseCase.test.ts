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
  it('updates an existing product to an intentional below-cost selling price', async () => {
    const { useCase, productRepo, publisher, product } = setup();

    const result = await useCase.execute({
      productId: product.id,
      workspaceId: product.workspaceId,
      sellingPrice: 399,
    });

    expect(result.isOk()).toBe(true);
    const updated = unwrap(result);
    expect(updated.sellingPrice.amount).toBe(399);
    expect(productRepo.items.get(product.id)?.sellingPrice.amount).toBe(399);
    expect(publisher.published.map((event) => event.type)).toContain('product.updated');
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

});
