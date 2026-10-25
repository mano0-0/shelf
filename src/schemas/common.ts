/**
 * Shared schema pieces, and the OpenAPI registry.
 *
 * Each schema is written once with Zod and used for three things:
 *   - the TypeScript type, via z.infer
 *   - runtime validation of the actual request
 *   - the OpenAPI document
 *
 * Writing them separately is how a spec drifts from the code it documents.
 * Deriving all three from one definition makes that impossible.
 */

import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const uuid = z.string().uuid();

/** A trimmed, non-empty string with a length bound. */
export function text(min: number, max: number) {
  return z.string().trim().min(min).max(max);
}

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof PaginationQuery>;

/**
 * The error envelope. Every failure response has this shape, so a client can
 * write one error handler rather than one per endpoint.
 */
export const ErrorResponse = registry.register(
  'Error',
  z.object({
    error: z.object({
      // Clients branch on this. The message is for humans and may change.
      code: z.string().openapi({ example: 'NOT_FOUND' }),
      message: z.string().openapi({ example: 'Book not found' }),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  }).openapi('Error'),
);

export type ErrorBody = z.infer<typeof ErrorResponse>;

/** Wrap an item schema in the standard list envelope. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}
