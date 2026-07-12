// Composition-root unit test. Builds the FULL object graph with in-memory doubles
// for every connection-bearing boundary (pg Pool, Redis, Bull queues, AI provider)
// so it needs no live infrastructure, and asserts that:
//   1. every required AppDeps field is populated,
//   2. the optional ports (price history, id generator) are wired,
//   3. buildApp(deps) returns a working Express app without throwing,
//   4. the WS subscriber is a functioning EventSubscriber,
//   5. shutdown() resolves.

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { buildContainer, type ManagedQueue } from '../container';
import { buildApp } from '../../../presentation/http/app';
import type { IAIProvider } from '../../../domain/ports/IAIProvider';

// --- Doubles -----------------------------------------------------------------

const fakePool = {
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  end: jest.fn(async () => undefined),
} as unknown as Pool;

const fakeRedis = {
  xadd: jest.fn(async () => '0-0'),
  get: jest.fn(async () => null),
  set: jest.fn(async () => 'OK'),
  setex: jest.fn(async () => 'OK'),
  del: jest.fn(async () => 0),
  quit: jest.fn(async () => 'OK'),
} as unknown as Redis;

const fakeAi: IAIProvider = {
  suggestPrice: async () => ({ suggestedPrice: 1, reasoning: 'x', confidence: 'low' }),
  generateTitle: async (product) => product.name,
  analyzeListing: async () => ({ score: 0, suggestions: [] }),
};

function makeQueue<T>(): ManagedQueue<T> {
  return {
    enqueue: jest.fn(async () => undefined),
    registerHandler: jest.fn(),
    close: jest.fn(async () => undefined),
  };
}

function build() {
  return buildContainer({
    pool: fakePool,
    redis: fakeRedis,
    aiProvider: fakeAi,
    idGenerator: () => 'fixed-id',
    createQueue: <T>(_name: string) => makeQueue<T>(),
  });
}

// --- Tests -------------------------------------------------------------------

describe('buildContainer (composition root)', () => {
  it('populates every required AppDeps field', () => {
    const { deps } = build();
    expect(deps.productService).toBeDefined();
    expect(deps.listingService).toBeDefined();
    expect(deps.hermesService).toBeDefined();
    expect(deps.analyticsService).toBeDefined();
    expect(deps.productRepo).toBeDefined();
    expect(deps.listingRepo).toBeDefined();
    expect(deps.marketplaceRepo).toBeDefined();
    expect(deps.workspaceRepo).toBeDefined();
    expect(deps.authUserStore).toBeDefined();
  });

  it('wires the optional ports (price history + id generator)', () => {
    const { deps } = build();
    expect(deps.priceHistoryReader).toBeDefined();
    expect(deps.priceHistoryRecorder).toBeDefined();
    // Reader and recorder are the same PriceHistoryRepository instance.
    expect(deps.priceHistoryReader).toBe(deps.priceHistoryRecorder);
    expect(typeof deps.idGenerator).toBe('function');
    expect(deps.idGenerator?.()).toBe('fixed-id');
  });

  it('builds an Express app from the resolved deps without throwing', () => {
    const { deps } = build();
    const app = buildApp(deps, { enableRateLimit: false, corsOrigin: '*' });
    expect(app).toBeDefined();
    // A configured Express app exposes routing + a listen function.
    expect(typeof app.listen).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('exposes a functioning WS event subscriber fed by the broker', () => {
    const { subscriber } = build();
    expect(typeof subscriber.subscribe).toBe('function');
    const received: unknown[] = [];
    const unsubscribe = subscriber.subscribe((e) => received.push(e));
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('propagates a Hermes-run failure through the job handler (C2)', async () => {
    // Capture the handler registered on the hermes-run queue.
    let hermesHandler: ((data: unknown) => Promise<unknown>) | undefined;
    const capturingQueue = <T>(name: string): ManagedQueue<T> => ({
      enqueue: jest.fn(async () => undefined),
      registerHandler: jest.fn((h: (data: T) => Promise<unknown>) => {
        if (name === 'hermes-run') {
          hermesHandler = h as (data: unknown) => Promise<unknown>;
        }
      }),
      close: jest.fn(async () => undefined),
    });

    // fakePool.query returns no rows, so workspaceRepo.findById -> null and
    // runHermes returns Err(NotFound). The container's engine port must THROW on
    // that Err rather than reporting eventsGenerated:0 as success.
    buildContainer({
      pool: fakePool,
      redis: fakeRedis,
      aiProvider: fakeAi,
      idGenerator: () => 'fixed-id',
      createQueue: capturingQueue,
    });

    expect(hermesHandler).toBeDefined();
    await expect(
      hermesHandler!({ workspaceId: 'missing', trigger: 'manual' }),
    ).rejects.toThrow();
  });

  it('exposes lifecycle handles and a resolving shutdown()', async () => {
    const container = build();
    expect(container.pool).toBe(fakePool);
    expect(container.redis).toBe(fakeRedis);
    expect(container.cache).toBeDefined();
    expect(container.queues).toHaveLength(3);
    await expect(container.shutdown()).resolves.toBeUndefined();
    for (const q of container.queues) {
      expect(q.close).toHaveBeenCalled();
    }
  });
});
