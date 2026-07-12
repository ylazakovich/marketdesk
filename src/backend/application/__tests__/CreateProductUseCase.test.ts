import { CreateProductUseCase } from '../usecases/CreateProductUseCase';
import { ProductService } from '../../domain/services/ProductService';
import { Workspace } from '../../domain/entities/Workspace';
import {
  InMemoryProductRepository,
  RecordingEventPublisher,
  unwrap,
} from '../../domain/testkit/support';
import { InMemoryWorkspaceRepository, idFactory } from '../testkit/support';
import type { CreateProductDTO } from '../dto/CreateProductDTO';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const publisher = new RecordingEventPublisher();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const workspace = unwrap(
    Workspace.create({ id: 'ws-1', name: 'Test', currency: 'PLN' }),
  );
  workspaceRepo.items.set(workspace.id, workspace);

  const service = new ProductService(productRepo, publisher);
  const useCase = new CreateProductUseCase(service, workspaceRepo, idFactory('prod'));
  return { useCase, productRepo, publisher, workspaceRepo };
}

const validDto: CreateProductDTO = {
  workspaceId: 'ws-1',
  sku: 'SKU-1',
  name: 'Vintage Lamp',
  description: 'A beautiful vintage brass lamp in excellent condition.',
  costPrice: 50,
  sellingPrice: 120,
  condition: 'good',
  category: 'home',
  images: ['a.jpg'],
};

describe('CreateProductUseCase', () => {
  it('creates a product, persists it and emits an event (happy path)', async () => {
    const { useCase, productRepo, publisher } = setup();

    const result = await useCase.execute(validDto);

    expect(result.isOk()).toBe(true);
    const product = unwrap(result);
    expect(product.sku).toBe('SKU-1');
    expect(product.sellingPrice.amount).toBe(120);
    expect(product.sellingPrice.currency).toBe('PLN');
    expect(productRepo.items.get(product.id)).toBe(product);
    expect(publisher.published.map((e) => e.type)).toContain('product.created');
  });

  it('fails validation when the description is too short', async () => {
    const { useCase, productRepo } = setup();

    const result = await useCase.execute({ ...validDto, description: 'too short' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(productRepo.items.size).toBe(0);
  });

  it('fails when the workspace does not exist', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ ...validDto, workspaceId: 'missing' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('NOT_FOUND');
  });

  it('rejects a duplicate SKU with a conflict', async () => {
    const { useCase } = setup();

    expect((await useCase.execute(validDto)).isOk()).toBe(true);
    const second = await useCase.execute({ ...validDto, name: 'Another' });

    expect(second.isErr()).toBe(true);
    if (second.isErr()) expect(second.error.code).toBe('CONFLICT');
  });
});
