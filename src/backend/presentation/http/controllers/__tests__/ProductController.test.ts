import { ProductController, parseStringList } from '../ProductController';

describe('ProductController list parsing', () => {
  it('preserves commas inside JSON-encoded tag values', () => {
    expect(parseStringList('["home, office","featured"]')).toEqual(['home, office', 'featured']);
  });

  it('keeps backward compatibility with comma-separated tags', () => {
    expect(parseStringList('audio, featured')).toEqual(['audio', 'featured']);
  });

  it('fails closed for malformed JSON arrays', () => {
    expect(parseStringList('["unterminated"')).toBeUndefined();
    expect(parseStringList('["valid", 2]')).toBeUndefined();
  });
});

describe('ProductController recheck', () => {
  it('forwards the authenticated workspace and actor to the non-publishing service', async () => {
    const result = {
      productId: 'product-1', workspaceId: 'workspace-1',
      productUpdatedAt: '2026-07-22T06:00:00.000Z', checkedAt: '2026-07-22T06:01:00.000Z',
      status: 'ready', canPublish: true, autoApplied: false, items: [],
      category: {
        providerCategoryId: 'provider-1', path: ['Electronics', 'Projectors'], confidence: 0.99,
        isLeaf: true, taxonomyVerifiedAt: '2026-07-22T05:00:00.000Z',
        taxonomyStaleAt: '2026-07-23T05:00:00.000Z', reason: null,
        suggestion: null, confirmationRequired: false,
      },
    } as const;
    const recheck = jest.fn(async () => result);
    const controller = new ProductController(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      () => 'id', { recheck } as never,
    );
    const req = {
      params: { id: 'product-1' },
      body: { listingId: 'listing-1' },
      user: { workspaceId: 'workspace-1', userId: 'user-1' },
    } as never;
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as never;
    const next = jest.fn();

    await controller.recheck(req, res, next);

    expect(recheck).toHaveBeenCalledWith({
      productId: 'product-1', listingId: 'listing-1', workspaceId: 'workspace-1', actorId: 'user-1',
    });
    expect(json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });
});
