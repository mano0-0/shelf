/**
 * Book request and response shapes.
 *
 * The status/rating pairing is expressed here as well as in the database
 * CHECK constraint. Two layers for one rule, deliberately: the schema gives
 * the caller a 400 that names the field, the constraint guarantees the rule
 * even for a writer that never passes through this code.
 */

import { z } from 'zod';
import { paginated, registry, text, uuid } from './common.js';

export const BookStatus = z.enum(['unread', 'reading', 'read']);
export type BookStatus = z.infer<typeof BookStatus>;

/** Allows the common ISBN-10/13 spellings, with or without hyphens. */
const isbn = z
  .string()
  .trim()
  .regex(/^[0-9Xx-]{10,17}$/, 'must be an ISBN-10 or ISBN-13, hyphens allowed');

export const Book = registry.register(
  'Book',
  z.object({
    id: uuid,
    title: z.string(),
    author: z.string(),
    isbn: z.string().nullable(),
    status: BookStatus,
    rating: z.number().int().min(1).max(5).nullable(),
    notes: z.string().nullable(),
    finishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }).openapi('Book'),
);

export type Book = z.infer<typeof Book>;

export const CreateBookBody = registry.register(
  'CreateBook',
  z.object({
    title: text(1, 300),
    author: text(1, 200),
    isbn: isbn.optional(),
    status: BookStatus.default('unread'),
    notes: z.string().max(2000).optional(),
  }).openapi('CreateBook'),
);

export type CreateBookInput = z.infer<typeof CreateBookBody>;

/**
 * Partial update. `.strict()` rejects unknown keys rather than ignoring
 * them: silently dropping `{ ratng: 5 }` leaves the caller believing a write
 * succeeded that never happened.
 */
export const UpdateBookBody = registry.register(
  'UpdateBook',
  z.object({
    title: text(1, 300).optional(),
    author: text(1, 200).optional(),
    isbn: isbn.nullable().optional(),
    status: BookStatus.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Provide at least one field to update',
    })
    // Mirrors the rating_requires_read constraint. Catching it here produces
    // a field-level message; the database catches it regardless.
    .refine(
      (body) => !(body.rating != null && body.status != null && body.status !== 'read'),
      { message: 'A rating can only be set on a book marked as read', path: ['rating'] },
    )
    .openapi('UpdateBook'),
);

export type UpdateBookInput = z.infer<typeof UpdateBookBody>;

export const BookListQuery = z.object({
  status: BookStatus.optional(),
  /** Case-insensitive substring match on title or author. */
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['created', 'title', 'rating']).default('created'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BookListQuery = z.infer<typeof BookListQuery>;

export const BookListResponse = registry.register(
  'BookList',
  paginated(Book).openapi('BookList'),
);

export const BookIdParam = z.object({ id: uuid });
