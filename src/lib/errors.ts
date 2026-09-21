/**
 * Stable, machine-readable error codes returned to the frontend.
 *
 * These strings are a public contract: the frontend branches on them, so they
 * must not be renamed once shipped. Messages may change freely; codes may not.
 */
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** The exact response body shape for every error the API returns. */
export type ErrorBody = {
  code: ErrorCode;
  message: string;
  correlationId: string;
};

/**
 * An error whose message and status code are safe to expose to a client.
 *
 * Anything thrown that is *not* an AppError is treated as untrusted by the
 * error handler: it becomes a generic 500 so internal details, stack traces,
 * and network topology never reach the caller (SECURITY.md).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(ErrorCodes.UNAUTHORIZED, 401, message);

export const forbidden = (message = 'Not permitted'): AppError =>
  new AppError(ErrorCodes.FORBIDDEN, 403, message);

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(ErrorCodes.NOT_FOUND, 404, message);

export const invalidRequest = (message = 'Request validation failed'): AppError =>
  new AppError(ErrorCodes.INVALID_REQUEST, 400, message);

export const rateLimited = (message = 'Too many requests'): AppError =>
  new AppError(ErrorCodes.RATE_LIMITED, 429, message);

export const notImplemented = (message = 'Not implemented'): AppError =>
  new AppError(ErrorCodes.NOT_IMPLEMENTED, 501, message);

export const buildErrorBody = (
  code: ErrorCode,
  message: string,
  correlationId: string,
): ErrorBody => ({ code, message, correlationId });
