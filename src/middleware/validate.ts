/**
 * Request validation.
 *
 * The parsed, typed result replaces the raw input on the request, so handlers
 * downstream read `req.body` already coerced and narrowed -- a query string's
 * `limit=20` arrives as the number 20, not the string "20".
 *
 * Unparsed input never reaches a handler: a route either declares a schema or
 * takes no input.
 */

import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

import { ValidationError } from '../lib/errors.js';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Flatten Zod's issue list into `{ field: [messages] }`. */
function describe(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // Express 5 makes req.query a getter, so it cannot be assigned.
        // Redefining the property is how the coerced values are carried
        // forward without reaching for a cast.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Request validation failed', describe(error)));
        return;
      }
      next(error);
    }
  };
}

/** Typed accessors, so handlers do not repeat the generic parameter. */
export function body<T extends ZodTypeAny>(req: { body: unknown }, _schema: T): z.infer<T> {
  return req.body as z.infer<T>;
}

export function queryOf<T extends ZodTypeAny>(
  req: { query: unknown },
  _schema: T,
): z.infer<T> {
  return req.query as z.infer<T>;
}
