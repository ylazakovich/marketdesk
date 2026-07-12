// Domain error hierarchy. Pure — no infrastructure concerns.

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GUARDRAIL_VIOLATION';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(message: string, code: DomainErrorCode) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    // Preserve prototype chain when targeting ES5-ish transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_STATE');
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT');
  }
}

export class GuardrailViolationError extends DomainError {
  constructor(message: string) {
    super(message, 'GUARDRAIL_VIOLATION');
  }
}
