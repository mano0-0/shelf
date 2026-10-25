/**
 * Shelf operations.
 *
 * Thin by design: the repository already scopes every query by owner and the
 * database already enforces the status/rating pairing, so what is left here
 * is turning "no row" into a 404 and stating the rules the other two layers
 * cannot express.
 */

import { InvalidStateError, NotFoundError } from '../lib/errors.js';
import * as repo from '../repositories/books.js';
import type {
  Book,
  BookListQuery,
  CreateBookInput,
  UpdateBookInput,
} from '../schemas/book.js';

export async function addBook(ownerId: string, input: CreateBookInput): Promise<Book> {
  return repo.create(ownerId, input);
}

/**
 * Fetch one book.
 *
 * A book owned by someone else produces 404, not 403. Distinguishing them
 * would confirm the id exists, which lets an attacker enumerate other
 * people's identifiers -- so a book the caller may not see is reported as a
 * book that does not exist.
 */
export async function getBook(ownerId: string, id: string): Promise<Book> {
  const book = await repo.findById(ownerId, id);
  if (!book) throw new NotFoundError('Book');
  return book;
}

export async function listBooks(
  ownerId: string,
  query: BookListQuery,
): Promise<{ items: Book[]; total: number; limit: number; offset: number }> {
  const { items, total } = await repo.list(ownerId, query);
  return { items, total, limit: query.limit, offset: query.offset };
}

export async function updateBook(
  ownerId: string,
  id: string,
  patch: UpdateBookInput,
): Promise<Book> {
  const existing = await repo.findById(ownerId, id);
  if (!existing) throw new NotFoundError('Book');

  // Rating a book that is neither already read nor being marked read in this
  // same request. The schema catches the case where both fields are present
  // and disagree; this catches the case where status is simply absent, which
  // the schema cannot see.
  const willBeRead = patch.status ? patch.status === 'read' : existing.status === 'read';
  if (patch.rating != null && !willBeRead) {
    throw new InvalidStateError(
      'A book can only be rated once it is marked as read',
    );
  }

  const updated = await repo.update(ownerId, id, patch);
  if (!updated) throw new NotFoundError('Book');
  return updated;
}

export async function deleteBook(ownerId: string, id: string): Promise<void> {
  const deleted = await repo.remove(ownerId, id);
  if (!deleted) throw new NotFoundError('Book');
}

export async function getStats(ownerId: string): Promise<repo.ShelfStats> {
  return repo.stats(ownerId);
}
