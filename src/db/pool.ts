/**
 * The PostgreSQL connection pool, and the query helpers built on it.
 *
 * Raw SQL, no ORM. The queries here are simple enough that an ORM would add
 * a layer to learn without removing one to write, and keeping the SQL visible
 * means the query a reader sees is the query the database runs.
 *
 * Every value is passed as a bound parameter ($1, $2, ...). String
 * interpolation into SQL does not appear anywhere in this file, and should
 * not appear anywhere in the project.
 */

import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

/**
 * Postgres returns NUMERIC as a string to avoid silent precision loss in
 * JavaScript's float64. Nothing here needs that protection -- ratings are
 * small integers -- and a string where a number is expected is a subtle bug,
 * so parse them. OID 1700 is NUMERIC.
 */
pg.types.setTypeParser(1700, (value: string) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.isTest ? 4 : 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Stop one pathological query from occupying a connection indefinitely.
  statement_timeout: 10_000,
});

pool.on('error', (error) => {
  // An idle client failing is not tied to any request, so it cannot be
  // surfaced through the normal error path. Log it rather than let it
  // become an unhandled 'error' event and take the process down.
  logger.error({ err: error }, 'idle database client error');
});

export interface QueryOptions {
  /** Run inside an existing transaction instead of taking a pool client. */
  client?: pg.PoolClient;
}

/** Run a query and return all rows. */
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  options: QueryOptions = {},
): Promise<T[]> {
  const executor = options.client ?? pool;
  const result = await executor.query<T>(sql, params as unknown[]);
  return result.rows;
}

/** Run a query expected to match at most one row. */
export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  options: QueryOptions = {},
): Promise<T | undefined> {
  const rows = await query<T>(sql, params, options);
  return rows[0];
}

/** Run a statement and report how many rows it affected. */
export async function execute(
  sql: string,
  params: readonly unknown[] = [],
  options: QueryOptions = {},
): Promise<number> {
  const executor = options.client ?? pool;
  const result = await executor.query(sql, params as unknown[]);
  return result.rowCount ?? 0;
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on
 * any thrown error. The client is always released, including when the
 * rollback itself fails.
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Report the rollback failure, but let the original error propagate --
      // it is the one that explains what actually went wrong.
      logger.error({ err: rollbackError }, 'rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

/** True when the database answers. Used by the health endpoint. */
export async function isHealthy(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** Postgres error codes this project reacts to by name rather than number. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
