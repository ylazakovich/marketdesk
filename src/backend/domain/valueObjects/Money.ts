// Money value object. Immutable, currency-aware, integer-minor-unit backed
// (grosze for PLN) to avoid floating-point drift. Default currency is PLN.

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError } from '../shared/DomainError';
import { DEFAULT_CURRENCY } from '../../../shared/constants';

export class Money {
  // Amount stored in minor units (e.g. grosze). Always an integer.
  private readonly _minor: number;
  private readonly _currency: string;

  private constructor(minor: number, currency: string) {
    this._minor = minor;
    this._currency = currency;
    Object.freeze(this);
  }

  // Build from a major-unit decimal amount (e.g. 29.99 PLN).
  static of(amount: number, currency: string = DEFAULT_CURRENCY): Result<Money> {
    if (!Number.isFinite(amount)) {
      return Err(new ValidationError('Money amount must be a finite number'));
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return Err(new ValidationError(`Invalid currency code: ${currency}`));
    }
    const minor = Math.round(amount * 100);
    return Ok(new Money(minor, currency));
  }

  // Build from an integer number of minor units.
  static fromMinor(minor: number, currency: string = DEFAULT_CURRENCY): Result<Money> {
    if (!Number.isInteger(minor)) {
      return Err(new ValidationError('Minor units must be an integer'));
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return Err(new ValidationError(`Invalid currency code: ${currency}`));
    }
    return Ok(new Money(minor, currency));
  }

  static zero(currency: string = DEFAULT_CURRENCY): Money {
    return new Money(0, currency);
  }

  // Major-unit decimal value (e.g. 29.99).
  get amount(): number {
    return this._minor / 100;
  }

  get minorUnits(): number {
    return this._minor;
  }

  get currency(): string {
    return this._currency;
  }

  private assertSameCurrency(other: Money): Result<true> {
    if (this._currency !== other._currency) {
      return Err(
        new ValidationError(
          `Currency mismatch: ${this._currency} vs ${other._currency}`,
        ),
      );
    }
    return Ok(true);
  }

  add(other: Money): Result<Money> {
    const check = this.assertSameCurrency(other);
    if (check.isErr()) return check;
    return Ok(new Money(this._minor + other._minor, this._currency));
  }

  subtract(other: Money): Result<Money> {
    const check = this.assertSameCurrency(other);
    if (check.isErr()) return check;
    return Ok(new Money(this._minor - other._minor, this._currency));
  }

  // Multiply by a scalar (e.g. quantity). Rounds to nearest minor unit.
  multiply(factor: number): Result<Money> {
    if (!Number.isFinite(factor)) {
      return Err(new ValidationError('Multiplier must be a finite number'));
    }
    return Ok(new Money(Math.round(this._minor * factor), this._currency));
  }

  equals(other: Money): boolean {
    return this._minor === other._minor && this._currency === other._currency;
  }

  isGreaterThan(other: Money): boolean {
    return this._currency === other._currency && this._minor > other._minor;
  }

  isGreaterThanOrEqual(other: Money): boolean {
    return this._currency === other._currency && this._minor >= other._minor;
  }

  isLessThan(other: Money): boolean {
    return this._currency === other._currency && this._minor < other._minor;
  }

  isLessThanOrEqual(other: Money): boolean {
    return this._currency === other._currency && this._minor <= other._minor;
  }

  isZero(): boolean {
    return this._minor === 0;
  }

  isNegative(): boolean {
    return this._minor < 0;
  }

  isPositive(): boolean {
    return this._minor > 0;
  }

  // Percentage change from this amount to another (as a signed fraction).
  // e.g. from 100 to 80 => -0.2. Returns 0 when the base is zero.
  fractionalChangeTo(other: Money): number {
    if (this._minor === 0) return 0;
    return (other._minor - this._minor) / this._minor;
  }

  format(locale = 'pl-PL'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this._currency,
    }).format(this.amount);
  }

  toString(): string {
    return `${this.amount.toFixed(2)} ${this._currency}`;
  }
}
