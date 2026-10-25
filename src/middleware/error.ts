/**
 * The single place an error becomes a response.
 *
 * Handlers and services throw; nothing below them writes an error body. That
 * is what keeps the error envelope identical across every endpoint, and it
 * means adding an endpoint cannot accidentally introduce a new error shape.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

import { AppError, NotFoundError, isAppError } from '../lib/errors.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/** Tag each request so a log line and an error body can be matched up. */
export const requestId: RequestHandler = (req, res, next) => {
  const existing = req.headers['x-request-id'];
  const id = typeof existing === 'string' && existing.length <= 200 ? existing : randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/** Anything that reaches here matched no route. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route'));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    // The response has already begun; Express's default handler is the only
    // thing that can sensibly deal with this.
    next(error);
    return;
  }

  const id = typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;

  if (isAppError(error)) {
    // Expected failures are information, not incidents: a 404 should not
    // page anyone, so only server-side faults are logged at error level.
    const level = error.status >= 500 ? 'error' : 'warn';
    logger[level]({ err: error, code: error.code, requestId: id }, error.message);

    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        ...(id ? { requestId: id } : {}),
      },
    });
    return;
  }

  // Anything unrecognised is a bug. Log it in full, but return a generic
  // body: stack traces and driver messages disclose internals, and the
  // request id is what actually lets support find the real error.
  logger.error({ err: error, requestId: id }, 'unhandled error');

  const body: Record<string, unknown> = {
    code: 'INTERNAL',
    message: 'An unexpected error occurred',
    ...(id ? { requestId: id } : {}),
  };

  // Outside production, include the real message -- the convenience is worth
  // it locally, and there is nothing to disclose to.
  if (!config.isProduction && error instanceof Error) {
    body.debug = { name: error.name, message: error.message };
  }

  res.status(500).json({ error: body });
};

/**
 * Wrap an async handler so a rejected promise reaches the error handler.
 *
 * Express 4 does not await handlers, so an async function that throws
 * produces an unhandled rejection and a request that simply hangs until it
 * times out. Every async route in this project goes through here.
 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export { AppError };
