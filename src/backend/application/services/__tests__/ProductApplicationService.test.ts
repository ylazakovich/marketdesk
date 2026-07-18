import { ProductApplicationService } from '../ProductApplicationService';
import { Product } from '../../../domain/entities/Product';
import { InMemoryProductRepository, money, unwrap } from '../../../domain/testkit/support';
import type { CreateProductUseCase } from '../../usecases/CreateProductUseCase';
import type { UpdateProductUseCase } from '../../usecases/UpdateProductUseCase';

describe('ProductApplicationService catalogue search', () => {
  it('searches tags before pagination and returns the real total', async () => {
    const repo = new InMemoryProductRepository();
    const tagged = unwrap(
      Product.create({
        id: 'p-tagged',
        workspaceId: 'ws-1',
        sku: 'SKU-1',
        name: 'Headphones',
        description: 'Wireless headphones model',
        costPrice: money(100),
        sellingPrice: money(200),
        condition: 'new',
        category: 'Audio',
        tags: ['featured'],
      })
    );
    const other = unwrap(
      Product.create({
        id: 'p-other',
        workspaceId: 'ws-1',
        sku: 'SKU-2',
        name: 'Keyboard',
        description: 'Mechanical keyboard model',
        costPrice: money(100),
        sellingPrice: money(200),
        condition: 'new',
        category: 'Computers',
        tags: ['office'],
      })
    );
    repo.items.set(tagged.id, tagged);
    repo.items.set(other.id, other);
    const service = new ProductApplicationService(
      repo,
      {} as CreateProductUseCase,
      {} as UpdateProductUseCase
    );

    const result = await service.listProducts({
      workspaceId: 'ws-1',
      search: 'FEATURED',
      limit: 1,
      offset: 0,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.total).toBe(1);
    expect(result.value.items.map((item) => item.id)).toEqual(['p-tagged']);
  });
});
