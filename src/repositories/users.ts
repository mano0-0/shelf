/**
 * User and refresh-token persistence.
 *
 * Repositories own the SQL and the row-to-domain mapping, nothing else. They
 * never throw HTTP errors and never read a request -- that belongs to the
 * service above, which keeps this layer testable with only a database.
 */

import type pg from 'pg';

import { PG_UNIQUE_VIOLATION, execute, isPgError, query, queryOne } from '../db/pool.js';
import { ConflictError } from '../lib/errors.js';
import type { User, UserRole } from '../schemas/auth.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  created_at: Date;
}

/** The public shape. Note the hash is absent -- see `findCredentialsByEmail`. */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

export interface NewUser {
  email: string;
  passwordHash: string;
  displayName: string;
}

export async function createUser(input: NewUser): Promise<User> {
  try {
    const row = await queryOne<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, display_name, role, created_at`,
      [input.email, input.passwordHash, input.displayName],
    );
    // RETURNING on a successful INSERT always yields a row.
    return toUser(row!);
  } catch (error) {
    // Let the database decide uniqueness rather than checking first: a
    // SELECT-then-INSERT has a race window between the two statements.
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new ConflictError('An account with that email already exists');
    }
    throw error;
  }
}

export async function findById(id: string): Promise<User | undefined> {
  const row = await queryOne<UserRow>(
    `SELECT id, email, password_hash, display_name, role, created_at
     FROM users WHERE id = $1`,
    [id],
  );
  return row ? toUser(row) : undefined;
}

/**
 * Fetch the password hash alongside the user, for login only.
 *
 * Kept as a separate function so the hash is never returned by accident: the
 * ordinary lookups above cannot leak it because they do not select it into
 * their result shape.
 */
export async function findCredentialsByEmail(
  email: string,
): Promise<{ user: User; passwordHash: string } | undefined> {
  const row = await queryOne<UserRow>(
    `SELECT id, email, password_hash, display_name, role, created_at
     FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  return row ? { user: toUser(row), passwordHash: row.password_hash } : undefined;
}

export async function updatePasswordHash(id: string, hash: string): Promise<void> {
  await execute('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
}

// --- refresh tokens ------------------------------------------------------

interface RefreshRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export async function storeRefreshToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  client?: pg.PoolClient,
): Promise<void> {
  await execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
    client ? { client } : {},
  );
}

/**
 * Look up a refresh token by its hash.
 *
 * Returns the row whether or not it is still valid, so the service can tell
 * "expired" from "revoked" from "never existed" and react differently.
 */
export async function findRefreshToken(
  tokenHash: string,
  client?: pg.PoolClient,
): Promise<RefreshRow | undefined> {
  return queryOne<RefreshRow>(
    `SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
    client ? { client } : {},
  );
}

export async function revokeRefreshToken(
  id: string,
  client?: pg.PoolClient,
): Promise<void> {
  await execute(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id],
    client ? { client } : {},
  );
}

/** Revoke every live token for a user. Used by logout-everywhere and on reuse. */
export async function revokeAllForUser(
  userId: string,
  client?: pg.PoolClient,
): Promise<number> {
  return execute(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
    client ? { client } : {},
  );
}

/** Housekeeping: drop tokens that expired a while ago. */
export async function deleteExpiredTokens(olderThanDays = 7): Promise<number> {
  return execute(
    `DELETE FROM refresh_tokens
     WHERE expires_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
}

export async function countUsers(): Promise<number> {
  const rows = await query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
