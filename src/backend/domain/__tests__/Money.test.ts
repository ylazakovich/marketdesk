import { Money } from '../valueObjects/Money';
import { unwrap } from '../testkit/support';

describe('Money', () => {
  it('creates from a major-unit decimal and exposes minor units', () => {
    const m = unwrap(Money.of(29.99));
    expect(m.amount).toBeCloseTo(29.99);
    expect(m.minorUnits).toBe(2999);
    expect(m.currency).toBe('PLN');
  });

  it('rejects non-finite amounts', () => {
    expect(Money.of(Number.NaN).isErr()).toBe(true);
  });

  it('rejects invalid currency codes', () => {
    expect(Money.of(10, 'zloty').isErr()).toBe(true);
  });

  it('adds and subtracts same-currency amounts', () => {
    const a = unwrap(Money.of(10));
    const b = unwrap(Money.of(2.5));
    expect(unwrap(a.add(b)).amount).toBeCloseTo(12.5);
    expect(unwrap(a.subtract(b)).amount).toBeCloseTo(7.5);
  });

  it('refuses cross-currency arithmetic', () => {
    const pln = unwrap(Money.of(10, 'PLN'));
    const eur = unwrap(Money.of(10, 'EUR'));
    expect(pln.add(eur).isErr()).toBe(true);
    expect(pln.subtract(eur).isErr()).toBe(true);
  });

  it('multiplies by a scalar', () => {
    const m = unwrap(Money.of(9.99));
    expect(unwrap(m.multiply(3)).amount).toBeCloseTo(29.97);
  });

  it('compares amounts and reports equality', () => {
    const a = unwrap(Money.of(10));
    const b = unwrap(Money.of(20));
    expect(a.isLessThan(b)).toBe(true);
    expect(b.isGreaterThan(a)).toBe(true);
    expect(a.isGreaterThanOrEqual(unwrap(Money.of(10)))).toBe(true);
    expect(a.equals(unwrap(Money.of(10)))).toBe(true);
  });

  it('computes fractional change (a 20% drop)', () => {
    const from = unwrap(Money.of(100));
    const to = unwrap(Money.of(80));
    expect(from.fractionalChangeTo(to)).toBeCloseTo(-0.2);
  });

  it('is immutable (frozen)', () => {
    expect(Object.isFrozen(unwrap(Money.of(10)))).toBe(true);
  });

  it('formats and stringifies', () => {
    const m = unwrap(Money.of(29.99));
    expect(typeof m.format()).toBe('string');
    expect(m.toString()).toBe('29.99 PLN');
  });
});
