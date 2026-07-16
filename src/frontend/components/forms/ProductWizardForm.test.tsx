import type { Marketplace } from '@shared/types';
import { emptyProductValues } from './productFormModel';
import {
  buildWizardMarketplaceOptions,
  validateWizardStep,
  verifyWizardMarketplaceReadiness,
} from './ProductWizardForm';

function marketplace(overrides: Partial<Marketplace> = {}): Marketplace {
  return {
    id: 'marketplace-olx',
    workspaceId: 'workspace-1',
    key: 'olx',
    name: 'OLX',
    connected: true,
    syncMode: 'manual',
    errorCount: 0,
    capacity: 100,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'Camera',
    sku: 'CAM-1',
    description: 'Camera in good condition with all required product details.',
    sellingPrice: 100,
    category: 'Electronics',
    images: ['https://example.com/camera.jpg'],
  };
}

describe('ProductWizardForm required-step validation', () => {
  it('requires at least one photo before leaving Photos', () => {
    const result = validateWizardStep(0, { ...validValues(), images: [] }, null, [marketplace()]);

    expect(result.fieldErrors.images).toBe('Add at least one product photo.');
  });

  it('rejects blank photo values and more than twelve photos', () => {
    expect(
      validateWizardStep(0, { ...validValues(), images: ['  '] }, null, [marketplace()]).fieldErrors
        .images
    ).toBe('Remove blank product photos.');
    expect(
      validateWizardStep(
        0,
        { ...validValues(), images: ['https://example.com/valid.jpg', ' '] },
        null,
        [marketplace()]
      ).fieldErrors.images
    ).toBe('Remove blank product photos.');
    expect(
      validateWizardStep(
        0,
        {
          ...validValues(),
          images: Array.from({ length: 13 }, (_, index) => `https://example.com/${index}.jpg`),
        },
        null,
        [marketplace()]
      ).fieldErrors.images
    ).toBe('Add no more than 12 product photos.');
  });

  it('requires a category before leaving Category', () => {
    const result = validateWizardStep(3, { ...validValues(), category: '  ' }, null, [
      marketplace(),
    ]);

    expect(result.fieldErrors.category).toBe('Choose a category.');
  });

  it('blocks Marketplace while connections are loading or unavailable', () => {
    expect(validateWizardStep(4, validValues(), null, undefined, true).marketplaceError).toContain(
      'load'
    );
    expect(
      validateWizardStep(4, validValues(), null, undefined, false, true).marketplaceError
    ).toContain('could not be loaded');
  });

  it('requires a real connected marketplace and an explicit selection', () => {
    const disconnected = marketplace({ connected: false });
    const connected = marketplace();

    expect(validateWizardStep(4, validValues(), null, [disconnected]).marketplaceError).toContain(
      'Connect at least one'
    );
    expect(validateWizardStep(4, validValues(), null, [connected]).marketplaceError).toBe(
      'Select a connected marketplace.'
    );
    expect(validateWizardStep(4, validValues(), 'allegro', [connected]).marketplaceError).toBe(
      'Select a connected marketplace.'
    );
    expect(validateWizardStep(4, validValues(), 'olx', [connected])).toEqual({ fieldErrors: {} });
  });
});

describe('ProductWizardForm marketplace options', () => {
  it('enables only connections reported as connected by the API', () => {
    const options = buildWizardMarketplaceOptions([
      marketplace(),
      marketplace({
        id: 'marketplace-allegro',
        key: 'allegro',
        name: 'Allegro',
        connected: false,
      }),
    ]);

    expect(options).toHaveLength(7);
    expect(options.find((option) => option.key === 'olx')).toMatchObject({
      configured: true,
      connected: true,
    });
    expect(options.find((option) => option.key === 'allegro')).toMatchObject({
      configured: true,
      connected: false,
    });
    expect(options.find((option) => option.key === 'ebay')).toMatchObject({
      configured: false,
      connected: false,
    });
  });
});

describe('ProductWizardForm authoritative marketplace readiness', () => {
  it('enables a local connection only after a matching authoritative check', async () => {
    const connected = marketplace();
    const check = jest.fn(async (id: string) => ({
      connected: true,
      marketplaceId: id,
      providerKey: 'olx' as const,
    }));

    const result = await verifyWizardMarketplaceReadiness([connected], check);

    expect(check).toHaveBeenCalledWith('marketplace-olx');
    expect(result).toEqual({ marketplaces: [connected], hadCheckError: false });
  });

  it('fails closed for identity mismatch, check failure, and local disconnection', async () => {
    const disconnected = marketplace({ id: 'marketplace-offline', connected: false });
    const mismatch = marketplace({ id: 'marketplace-mismatch' });
    const failed = marketplace({ id: 'marketplace-failed' });
    const check = jest.fn(async (id: string) => {
      if (id === failed.id) throw new Error('credentials cannot be decrypted');
      return { connected: true, marketplaceId: 'other-id', providerKey: 'olx' as const };
    });

    const result = await verifyWizardMarketplaceReadiness([disconnected, mismatch, failed], check);

    expect(check).toHaveBeenCalledTimes(2);
    expect(result.marketplaces.every((item) => !item.connected)).toBe(true);
    expect(result.hadCheckError).toBe(true);
  });
});
