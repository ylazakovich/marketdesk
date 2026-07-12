// Workspace aggregate root (multi-tenancy). Per ARCHITECTURE.md §3/§7 plus
// configurable Hermes guardrails (ARCHITECTURE_AMENDMENTS FIX #5).

import { Result, Ok, Err } from '../shared/Result';
import { ValidationError } from '../shared/DomainError';
import type { AutonomyLevel, HermesGuardrails } from '../../../shared/types';
import {
  AUTONOMY_LEVEL_LIST,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEZONE,
  DEFAULT_HERMES_GUARDRAILS,
} from '../../../shared/constants';

export interface CreateWorkspaceProps {
  id: string;
  name: string;
  currency?: string;
  timezone?: string;
  autonomyLevel?: AutonomyLevel;
  guardrails?: HermesGuardrails;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Workspace {
  private constructor(
    public readonly id: string,
    private _name: string,
    public readonly currency: string,
    public readonly timezone: string,
    private _autonomyLevel: AutonomyLevel,
    private _guardrails: HermesGuardrails,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(props: CreateWorkspaceProps): Result<Workspace> {
    if (!props.id?.trim()) {
      return Err(new ValidationError('Workspace id is required'));
    }
    if (!props.name?.trim()) {
      return Err(new ValidationError('Workspace name is required'));
    }
    const currency = props.currency ?? DEFAULT_CURRENCY;
    if (!/^[A-Z]{3}$/.test(currency)) {
      return Err(new ValidationError(`Invalid currency code: ${currency}`));
    }
    const autonomyLevel = props.autonomyLevel ?? 'suggest_only';
    if (!AUTONOMY_LEVEL_LIST.includes(autonomyLevel)) {
      return Err(new ValidationError(`Invalid autonomy level: ${autonomyLevel}`));
    }

    const now = new Date();
    return Ok(
      new Workspace(
        props.id,
        props.name.trim(),
        currency,
        props.timezone ?? DEFAULT_TIMEZONE,
        autonomyLevel,
        props.guardrails ?? { ...DEFAULT_HERMES_GUARDRAILS },
        props.createdAt ?? now,
        props.updatedAt ?? now,
      ),
    );
  }

  // --- Getters ---
  get name(): string {
    return this._name;
  }
  get autonomyLevel(): AutonomyLevel {
    return this._autonomyLevel;
  }
  get guardrails(): HermesGuardrails {
    return this._guardrails;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  // --- Behavior ---
  setAutonomyLevel(level: AutonomyLevel): Result<void> {
    if (!AUTONOMY_LEVEL_LIST.includes(level)) {
      return Err(new ValidationError(`Invalid autonomy level: ${level}`));
    }
    this._autonomyLevel = level;
    this.touch();
    return Ok(undefined);
  }

  updateGuardrails(patch: Partial<HermesGuardrails>): Result<void> {
    const next = { ...this._guardrails, ...patch };
    if (next.maxAutoPriceChangePct < 0 || next.maxAutoPriceChangePct > 100) {
      return Err(new ValidationError('maxAutoPriceChangePct must be within [0, 100]'));
    }
    if (next.minMarginFloor < 0 || next.minMarginFloor > 100) {
      return Err(new ValidationError('minMarginFloor must be within [0, 100]'));
    }
    this._guardrails = next;
    this.touch();
    return Ok(undefined);
  }

  rename(name: string): Result<void> {
    if (!name?.trim()) {
      return Err(new ValidationError('Workspace name is required'));
    }
    this._name = name.trim();
    this.touch();
    return Ok(undefined);
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
