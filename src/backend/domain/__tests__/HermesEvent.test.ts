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

describe('HermesEvent lifecycle transitions', () => {
  it('moves human approval through applying to applied', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    expect(event.approve().isOk()).toBe(true);
    expect(event.status).toBe('applying');
    expect(event.resolvedAt).toBeNull();
    expect(event.markApplied().isOk()).toBe(true);
    expect(event.status).toBe('applied');
    expect(event.resolvedAt).not.toBeNull();
  });

  it('records applying failures as terminal failed events', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    expect(event.markFailed().isOk()).toBe(true);
    expect(event.status).toBe('failed');
    expect(event.markApplied().isErr()).toBe(true);
  });

  it('moves automatic decisions through applying', () => {
    const event = unwrap(
      HermesEvent.create(priceEvent(100, 95, { status: 'pending_decision' })),
    );
    expect(event.beginAutoApply().isOk()).toBe(true);
    expect(event.status).toBe('applying');
  });

  it('can route a guarded automatic decision to human review', () => {
    const event = unwrap(
      HermesEvent.create(priceEvent(100, 70, { status: 'pending_decision' })),
    );
    expect(event.requestReview().isOk()).toBe(true);
    expect(event.status).toBe('pending_review');
  });

  it('dismisses pending review and pending decision events only', () => {
    const review = unwrap(HermesEvent.create(priceEvent(100, 95)));
    expect(review.dismiss().isOk()).toBe(true);
    expect(review.status).toBe('dismissed');

    const decision = unwrap(
      HermesEvent.create(priceEvent(100, 95, { status: 'pending_decision' })),
    );
    expect(decision.dismiss().isOk()).toBe(true);
    expect(decision.status).toBe('dismissed');
    expect(decision.approve().isErr()).toBe(true);
  });

  it('defines undo as applied -> reverting -> reverted', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    unwrap(event.markApplied());
    expect(event.beginRevert().isOk()).toBe(true);
    expect(event.status).toBe('reverting');
    expect(event.markReverted().isOk()).toBe(true);
    expect(event.status).toBe('reverted');
  });

  it('rejects completing a forward application as reverted', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    expect(event.markReverted().isErr()).toBe(true);
    expect(event.status).toBe('applying');
  });

  it('rejects completing an undo as applied', () => {
    const event = unwrap(HermesEvent.create(priceEvent(100, 95)));
    unwrap(event.approve());
    unwrap(event.markApplied());
    unwrap(event.beginRevert());
    expect(event.markApplied().isErr()).toBe(true);
    expect(event.status).toBe('reverting');
  });

  it('rejects invalid terminal-state transitions', () => {
    const event = unwrap(
      HermesEvent.create(
        priceEvent(100, 95, { status: 'failed', resolvedAt: new Date() }),
      ),
    );
    expect(event.approve().isErr()).toBe(true);
    expect(event.dismiss().isErr()).toBe(true);
    expect(event.beginRevert().isErr()).toBe(true);
    expect(event.markApplied().isErr()).toBe(true);
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
