import { HermesApplicationService } from './HermesApplicationService';
import { HermesEvent } from '../../domain/entities/HermesEvent';
import { InMemoryEventRepository, unwrap } from '../../domain/testkit/support';

function event(id: string, productId: string) {
  return unwrap(
    HermesEvent.create({
      id,
      workspaceId: 'workspace-1',
      productId,
      type: 'suggested_better_title',
      severity: 'info',
      title: `Suggestion ${id}`,
      proposedChange: { kind: 'title', field: 'title', from: 'Old', to: 'New' },
      createdAt: new Date(`2026-07-15T18:0${id === 'current' ? '1' : '2'}:00.000Z`),
    })
  );
}

describe('HermesApplicationService.listEvents', () => {
  it('filters product recommendations before pagination', async () => {
    const eventRepo = new InMemoryEventRepository();
    await eventRepo.save(event('current', 'product-1'));
    await eventRepo.save(event('other', 'product-2'));

    const service = new HermesApplicationService(eventRepo, {} as never, {} as never, {} as never);

    const page = await service.listEvents({
      workspaceId: 'workspace-1',
      productId: 'product-1',
      limit: 1,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items.map(({ id }) => id)).toEqual(['current']);
  });
});
