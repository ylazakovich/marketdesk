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
});
