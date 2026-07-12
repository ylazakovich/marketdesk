// Infrastructure-level marketplace error hierarchy. These are deliberately
// separate from the domain error hierarchy (domain/shared/DomainError) — the
// domain must not know about HTTP status codes or marketplace transports.

export type MarketplaceErrorCode =
  | 'AUTHENTICATION'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'NOT_IMPLEMENTED'
  | 'TRANSIENT'
  | 'UNKNOWN';

export class MarketplaceError extends Error {
  readonly code: MarketplaceErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: MarketplaceErrorCode,
    retryable = false,
    cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MarketplaceAuthenticationError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'AUTHENTICATION', false, cause);
  }
}

export class MarketplaceNotFoundError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NOT_FOUND', false, cause);
  }
}

export class MarketplaceRateLimitError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'RATE_LIMIT', true, cause);
  }
}

export class MarketplaceNotImplementedError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NOT_IMPLEMENTED', false, cause);
  }
}

export class MarketplaceTransientError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'TRANSIENT', true, cause);
  }
}

export class MarketplaceUnknownError extends MarketplaceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'UNKNOWN', false, cause);
  }
}
