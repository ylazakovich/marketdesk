import {
  emptyProductValues,
  marginWarning,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel';

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'AirPods 4',
    sku: 'AIRPODS4-PL-001',
    description: 'AirPods in good condition with all required details.',
    costPrice: 649,
    sellingPrice: 399,
    category: 'electronics',
  };
}

describe('productFormModel below-cost pricing', () => {
  it('keeps below-cost pricing as a warning instead of a validation error', () => {
    const values = validValues();

    expect(validateProductValues(values)).toEqual({});
    expect(marginWarning(values)).toContain('250');
    expect(marginWarning(values)).toContain('-62.7% margin');
  });

  it('marks below-cost submissions with the documented API flag', () => {
    expect(toProductSubmissionValues(validValues()).allowBelowCost).toBe(true);
  });

  it('does not mark profitable submissions as below-cost', () => {
    const values = { ...validValues(), sellingPrice: 799 };

    expect(marginWarning(values)).toBeNull();
    expect(toProductSubmissionValues(values).allowBelowCost).toBeUndefined();
  });
});
