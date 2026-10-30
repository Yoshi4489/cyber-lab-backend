import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ErrorCodes, buildErrorBody, type ErrorCode } from '../lib/errors.js';

/**
 * Installs the single place where an error becomes an HTTP response.
 *
 * Contract: every non-2xx body is `{ code, message, correlationId }`.
 * Nothing else escapes — no stack traces, no framework messages, no upstream
 * hostnames or connection strings (SECURITY.md). Unknown throws are logged in
 * full on the server and flattened to a generic 500 for the caller, so the
 * correlation id is the only thing a user needs to quote to get support.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    void reply
      .code(404)
      .send(buildErrorBody(ErrorCodes.NOT_FOUND, 'Route not found', request.id));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const { statusCode, code, message, expected } = classify(error);

    if (expected) {
      request.log.warn({ err: error, errorCode: code, statusCode }, 'request rejected');
    } else {
      request.log.error({ err: error, statusCode }, 'unhandled error');
    }

    void reply.code(statusCode).send(buildErrorBody(code, message, request.id));
  });
}

type Classified = {
  statusCode: number;
  code: ErrorCode;
  message: string;
  /** True when this is a deliberate rejection rather than a defect. */
  expected: boolean;
};

function classify(error: FastifyError): Classified {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      expected: true,
    };
  }

  if (error.validation !== undefined) {
    return {
      statusCode: 400,
      code: ErrorCodes.INVALID_REQUEST,
      message: 'Request validation failed',
      expected: true,
    };
  }

  const statusCode = error.statusCode ?? 500;

  if (statusCode === 429) {
    return {
      statusCode,
      code: ErrorCodes.RATE_LIMITED,
      message: 'Too many requests',
      expected: true,
    };
  }

  // Other 4xx come from the framework (bad JSON, unsupported media type, body
  // too large). The status is meaningful; the framework's wording is not worth
  // exposing, so it is replaced with a fixed message.
  if (statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      code: ErrorCodes.INVALID_REQUEST,
      message: 'Request could not be processed',
      expected: true,
    };
  }

  return {
    statusCode: 500,
    code: ErrorCodes.INTERNAL_ERROR,
    message: 'Internal server error',
    expected: false,
  };
}
