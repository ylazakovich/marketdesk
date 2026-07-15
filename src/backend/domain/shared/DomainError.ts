// Domain error hierarchy. Pure — no infrastructure concerns.

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GUARDRAIL_VIOLATION'
  | 'SERVICE_UNAVAILABLE';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: DomainErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    // Preserve prototype chain when targeting ES5-ish transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
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
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'GUARDRAIL_VIOLATION', details);
  }
}

export class ServiceUnavailableError extends DomainError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, 'SERVICE_UNAVAILABLE');
    this.cause = cause;
  }
}
