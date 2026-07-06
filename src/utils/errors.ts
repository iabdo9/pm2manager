/**
 * Typed application errors.
 *
 * Controllers and services throw these; the central error-handling
 * middleware turns them into consistent JSON responses. Using a single
 * `AppError` base keeps status codes, machine-readable codes and
 * client-safe messages in one place.
 */

/** Base class for all expected/operational errors. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  /** Operational errors are safe to report to the client. */
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'TOO_MANY_REQUESTS');
  }
}

/** Raised when the PM2 daemon cannot be reached or an API call fails. */
export class Pm2Error extends AppError {
  constructor(message = 'PM2 operation failed', details?: unknown) {
    super(message, 502, 'PM2_ERROR', details);
  }
}

/** Type guard for AppError. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
