import { HermesEvent, CreateHermesEventProps } from '../entities/HermesEvent';
import { unwrap } from '../testkit/support';
import type { PriceChangePayload } from '../../../shared/types';

function priceEvent(
  from: number,
  to: number,
  overrides: Partial<CreateHermesEventProps> = {},
): CreateHermesEventProps {
  const change: PriceChangePayload = { kind: 'price', field: 'price', from, to };
  return {
    id: 'e1',
    workspaceId: 'w1',
    productId: 'p1',
    type: 'suggested_lower_price',
    severity: 'warning',
    title: 'Lower price',
    proposedChange: change,
    ...overrides,
  };
}

describe('HermesEvent creation invariants', () => {
  it('requires a typed price change for price events', () => {
    const r = HermesEvent.create(priceEvent(100, 90, { proposedChange: null }));
    expect(r.isErr()).toBe(true);
  });

  it('creates a valid price event as pending_review by default', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 90)));
    expect(event.status).toBe('pending_review');
  });

  it('allows a null change for informational photo suggestions', () => {
    const r = HermesEvent.create({
      id: 'e2',
      workspaceId: 'w1',
      type: 'suggested_more_photos',
      severity: 'info',
      title: 'Add photos',
      proposedChange: null,
    });
    expect(r.isOk()).toBe(true);
  });
});

describe('HermesEvent approval rules', () => {
  it('approves a pending event and transitions to applied', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    expect(event.approve().isOk()).toBe(true);
    expect(event.status).toBe('applied');
    expect(event.resolvedAt).not.toBeNull();
  });

  it('cannot approve twice', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    expect(event.approve().isErr()).toBe(true);
  });

  it('dismisses a pending event', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    expect(event.dismiss().isOk()).toBe(true);
    expect(event.status).toBe('dismissed');
  });

  it('cannot dismiss an applied event', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    expect(event.dismiss().isErr()).toBe(true);
  });
});

describe('HermesEvent requiresHumanReview', () => {
  it('is true for critical competitor price detections', () => {
    const event = unwrap(
      HermesEvent.create(
        priceEvent(100, 90, {
          type: 'competitor_price_detected',
          severity: 'critical',
        }),
      ),
    );
    expect(event.requiresHumanReview()).toBe(true);
  });

  it('is true for price drops greater than 20%', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 70)));
    expect(event.requiresHumanReview()).toBe(true);
  });

  it('is false for small price drops', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    expect(event.requiresHumanReview()).toBe(false);
  });
});
