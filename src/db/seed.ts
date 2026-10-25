/**
 * Demo data, so a fresh clone has something to look at.
 *
 * Goes through the repositories rather than raw INSERTs, so the seeded rows
 * are exactly what the API would have produced -- including the hashed
 * password and the status/rating pairing the schema enforces.
 *
 *   npm run seed
 *
 * Idempotent: running it twice leaves one demo account and one set of books.
 */

import { fileURLToPath } from 'node:url';

import { closePool, query } from './pool.js';
import { hashPassword } from '../lib/passwords.js';
import { logger } from '../lib/logger.js';
import * as booksRepo from '../repositories/books.js';
import * as usersRepo from '../repositories/users.js';
import type { BookStatus } from '../schemas/book.js';

export const DEMO_EMAIL = 'demo@shelf.local';
export const DEMO_PASSWORD = 'demo-password-long-enough';

interface Seed {
  title: string;
  author: string;
  status: BookStatus;
  rating?: number;
  notes?: string;
}

const BOOKS: Seed[] = [
  { title: 'Dune', author: 'Frank Herbert', status: 'read', rating: 5,
    notes: 'Worth the reputation.' },
  { title: 'The Pragmatic Programmer', author: 'Andrew Hunt', status: 'read', rating: 5 },
  { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', status: 'read', rating: 4 },
  { title: 'Refactoring', author: 'Martin Fowler', status: 'read', rating: 4 },
  { title: 'Piranesi', author: 'Susanna Clarke', status: 'read', rating: 5,
    notes: 'Short and strange.' },
  { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', status: 'read', rating: 3 },
  { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann',
    status: 'reading', notes: 'Chapter 7, on transactions, is the one.' },
  { title: 'Site Reliability Engineering', author: 'Betsy Beyer', status: 'reading' },
  { title: 'The Phoenix Project', author: 'Gene Kim', status: 'unread' },
  { title: 'A Philosophy of Software Design', author: 'John Ousterhout', status: 'unread' },
  { title: 'Babel', author: 'R. F. Kuang', status: 'unread', notes: 'Recommended twice now.' },
  { title: 'Project Hail Mary', author: 'Andy Weir', status: 'unread' },
];

export async function seed(): Promise<{ email: string; password: string; books: number }> {
  // Start from a clean demo account so re-running does not accumulate
  // duplicates. ON DELETE CASCADE removes that user's books with them.
  await query('DELETE FROM users WHERE lower(email) = lower($1)', [DEMO_EMAIL]);

  const user = await usersRepo.createUser({
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
    displayName: 'Demo Reader',
  });

  for (const entry of BOOKS) {
    const book = await booksRepo.create(user.id, {
      title: entry.title,
      author: entry.author,
      status: 'unread',
      ...(entry.notes ? { notes: entry.notes } : {}),
    });

    // Status and rating are applied as an update, because the create schema
    // does not accept a rating -- the same route the API takes, so the
    // rating_requires_read constraint is exercised rather than bypassed.
    if (entry.status !== 'unread') {
      await booksRepo.update(user.id, book.id, {
        status: entry.status,
        ...(entry.rating !== undefined ? { rating: entry.rating } : {}),
      });
    }
  }

  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, books: BOOKS.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(({ email, password, books }) => {
      logger.info(`seeded ${books} books`);
      // Printed rather than logged: this is the thing the reader needs, and
      // it should not vanish when LOG_LEVEL is raised.
      process.stdout.write(
        `\n  Demo account\n    email:    ${email}\n    password: ${password}\n\n`,
      );
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'seed failed');
      process.exit(1);
    });
}
