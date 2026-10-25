/**
 * Typed domain errors, and the single place they become HTTP responses.
 *
 * Services throw these without knowing anything about HTTP. The error
 * middleware is the only code that maps them to status codes, so the mapping
 * lives in one readable list rather than being rediscovered in every
 * controller -- and a service stays testable without a request object.
 *
 * Every error carries a stable `code`. Clients should branch on that string,
 * never on the human-readable message, which is free to change.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 -- the request did not match its schema. */
export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

/** 401 -- no usable credentials were presented. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', 401, message);
  }
}

/**
 * 401 -- the email or the password was wrong.
 *
 * Deliberately one error for both cases: distinguishing them tells an
 * attacker which email addresses are registered.
 */
export class InvalidCredentialsError extends AppError {
  constructor(message = 'Email or password is incorrect') {
    super('INVALID_CREDENTIALS', 401, message);
  }
}

/** 401 -- the token was valid once. Clients use this to trigger a refresh. */
export class TokenExpiredError extends AppError {
  constructor(message = 'Token has expired') {
    super('TOKEN_EXPIRED', 401, message);
  }
}

/** 403 -- authenticated, but not allowed to do this. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', 403, message);
  }
}

/** 404 -- no such resource, or none this caller may see. */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', 404, `${resource} not found`);
  }
}

/** 409 -- a uniqueness constraint would be violated. */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super('ALREADY_EXISTS', 409, message);
  }
}

/**
 * 409 -- the operation is not legal from the resource's current state.
 *
 * Distinct from a validation error: the request was well-formed, it just
 * cannot be applied right now (rating a book that has not been read, say).
 */
export class InvalidStateError extends AppError {
  constructor(message: string) {
    super('INVALID_STATE', 409, message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
