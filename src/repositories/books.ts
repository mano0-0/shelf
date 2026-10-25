/**
 * Book persistence.
 *
 * Every query here is scoped by owner_id. Ownership is a WHERE clause, not a
 * check performed after loading the row: a missing filter would otherwise be
 * a silent cross-tenant read, and that failure mode is invisible in testing
 * when every test user owns everything they query.
 */

import {
  PG_UNIQUE_VIOLATION,
  execute,
  isPgError,
  query,
  queryOne,
} from '../db/pool.js';
import { ConflictError } from '../lib/errors.js';
import type {
  Book,
  BookListQuery,
  CreateBookInput,
  UpdateBookInput,
} from '../schemas/book.js';

interface BookRow {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  status: Book['status'];
  rating: number | null;
  notes: string | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, title, author, isbn, status, rating, notes,
                 finished_at, created_at, updated_at`;

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function create(ownerId: string, input: CreateBookInput): Promise<Book> {
  try {
    const row = await queryOne<BookRow>(
      `INSERT INTO books (owner_id, title, author, isbn, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        ownerId,
        input.title,
        input.author,
        input.isbn ?? null,
        input.status,
        input.notes ?? null,
      ],
    );
    return toBook(row!);
  } catch (error) {
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new ConflictError('That book is already on your shelf');
    }
    throw error;
  }
}

export async function findById(ownerId: string, id: string): Promise<Book | undefined> {
  const row = await queryOne<BookRow>(
    `SELECT ${COLUMNS} FROM books WHERE id = $1 AND owner_id = $2`,
    [id, ownerId],
  );
  return row ? toBook(row) : undefined;
}

/**
 * List a user's books, filtered and sorted.
 *
 * The sort column comes from a closed map rather than from the query string,
 * because an ORDER BY cannot be a bound parameter. Interpolating the raw
 * value would be an injection point; a lookup in a fixed object cannot be.
 */
const SORT_COLUMNS = {
  created: 'created_at',
  title: 'lower(title)',
  rating: 'rating',
} as const;

export async function list(
  ownerId: string,
  options: BookListQuery,
): Promise<{ items: Book[]; total: number }> {
  const filters: string[] = ['owner_id = $1'];
  const params: unknown[] = [ownerId];

  if (options.status) {
    params.push(options.status);
    filters.push(`status = $${params.length}`);
  }

  if (options.q) {
    params.push(`%${options.q}%`);
    // ILIKE is a case-insensitive LIKE. The % wrapping happens here, so the
    // user's text is still a bound parameter and cannot alter the pattern's
    // structure.
    filters.push(`(title ILIKE $${params.length} OR author ILIKE $${params.length})`);
  }

  const where = filters.join(' AND ');
  const sortColumn = SORT_COLUMNS[options.sort];
  const direction = options.order === 'asc' ? 'ASC' : 'DESC';

  const totals = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM books WHERE ${where}`,
    params,
  );
  const total = Number.parseInt(totals[0]?.count ?? '0', 10);

  params.push(options.limit, options.offset);
  const rows = await query<BookRow>(
    `SELECT ${COLUMNS} FROM books
     WHERE ${where}
     ORDER BY ${sortColumn} ${direction} NULLS LAST, id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { items: rows.map(toBook), total };
}

/**
 * Apply a partial update.
 *
 * Only the fields actually present are written, so an absent key leaves the
 * column alone while an explicit null clears it. Building the SET list from
 * the keys present is what makes those two cases distinguishable.
 */
export async function update(
  ownerId: string,
  id: string,
  patch: UpdateBookInput,
): Promise<Book | undefined> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  const push = (column: string, value: unknown): void => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };

  if (patch.title !== undefined) push('title', patch.title);
  if (patch.author !== undefined) push('author', patch.author);
  if (patch.isbn !== undefined) push('isbn', patch.isbn);
  if (patch.notes !== undefined) push('notes', patch.notes);
  if (patch.rating !== undefined) push('rating', patch.rating);

  if (patch.status !== undefined) {
    push('status', patch.status);
    // finished_at is derived from status rather than accepted from the
    // client, so the two cannot disagree. Moving off 'read' also clears the
    // rating, which the database would otherwise reject outright.
    if (patch.status === 'read') {
      assignments.push('finished_at = COALESCE(finished_at, now())');
    } else {
      assignments.push('finished_at = NULL');
      if (patch.rating === undefined) assignments.push('rating = NULL');
    }
  }

  if (assignments.length === 0) return findById(ownerId, id);

  params.push(id, ownerId);
  try {
    const row = await queryOne<BookRow>(
      `UPDATE books SET ${assignments.join(', ')}
       WHERE id = $${params.length - 1} AND owner_id = $${params.length}
       RETURNING ${COLUMNS}`,
      params,
    );
    return row ? toBook(row) : undefined;
  } catch (error) {
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new ConflictError('Another book on your shelf already has that title and author');
    }
    throw error;
  }
}

export async function remove(ownerId: string, id: string): Promise<boolean> {
  const affected = await execute(
    'DELETE FROM books WHERE id = $1 AND owner_id = $2',
    [id, ownerId],
  );
  return affected > 0;
}

export interface ShelfStats {
  total: number;
  unread: number;
  reading: number;
  read: number;
  averageRating: number | null;
}

export async function stats(ownerId: string): Promise<ShelfStats> {
  const rows = await query<{
    total: string;
    unread: string;
    reading: string;
    read: string;
    average_rating: number | null;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE status = 'unread')::text  AS unread,
            count(*) FILTER (WHERE status = 'reading')::text AS reading,
            count(*) FILTER (WHERE status = 'read')::text    AS read,
            round(avg(rating), 2) AS average_rating
     FROM books WHERE owner_id = $1`,
    [ownerId],
  );

  const row = rows[0];
  return {
    total: Number.parseInt(row?.total ?? '0', 10),
    unread: Number.parseInt(row?.unread ?? '0', 10),
    reading: Number.parseInt(row?.reading ?? '0', 10),
    read: Number.parseInt(row?.read ?? '0', 10),
    averageRating: row?.average_rating ?? null,
  };
}
