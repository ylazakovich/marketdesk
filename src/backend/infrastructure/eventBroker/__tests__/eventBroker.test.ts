import { RedisEventBroker, RedisStreamClient } from '../RedisEventBroker';
import { EventPublisher } from '../EventPublisher';
import type { EventBroker } from '../RedisEventBroker';
import type { DomainEvent as PortDomainEvent } from '../../../domain/ports/IEventPublisher';

const event: PortDomainEvent = {
  type: 'listing.published',
  aggregateType: 'listing',
  aggregateId: 'l-1',
  payload: { externalListingId: 'olx-1', marketplaceKey: 'olx' },
  occurredAt: new Date('2026-07-11T10:00:00.000Z'),
};

describe('RedisEventBroker', () => {
  it('XADDs the event to the per-aggregate stream with flattened fields', async () => {
    const xadd = jest.fn<Promise<string | null>, string[]>(async () => '1720000000000-0');
    const stream: RedisStreamClient = { xadd };
    const broker = new RedisEventBroker(stream, { streamPrefix: 'test:events:' });

    const id = await broker.publish(event);

    expect(id).toBe('1720000000000-0');
    expect(xadd).toHaveBeenCalledTimes(1);
    const args = xadd.mock.calls[0];
    expect(args[0]).toBe('test:events:listing'); // stream key
    expect(args[1]).toBe('*'); // auto id
    // field/value pairs
    expect(args).toContain('type');
    expect(args).toContain('listing.published');
    expect(args).toContain('aggregateId');
    expect(args).toContain('l-1');
    const payloadIdx = args.indexOf('payload');
    expect(JSON.parse(args[payloadIdx + 1] as string)).toEqual(event.payload);
    const occurredIdx = args.indexOf('occurredAt');
    expect(args[occurredIdx + 1]).toBe('2026-07-11T10:00:00.000Z');
  });

  it('returns an empty string when XADD yields null', async () => {
    const broker = new RedisEventBroker({ xadd: async () => null });
    await expect(broker.publish(event)).resolves.toBe('');
  });
});

describe('EventPublisher (IEventPublisher)', () => {
  it('delegates publishing to the injected broker', async () => {
    const publish = jest.fn(async () => 'ok-id');
    const broker: EventBroker = { publish } as unknown as EventBroker;
    const publisher = new EventPublisher(broker);

    await publisher.publish(event);

    expect(publish).toHaveBeenCalledWith(event);
  });

  it('resolves void even though the broker returns an id', async () => {
    const broker: EventBroker = { publish: async () => 'id-123' };
    const publisher = new EventPublisher(broker);
    await expect(publisher.publish(event)).resolves.toBeUndefined();
  });
});
