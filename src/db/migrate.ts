/**
 * Forward-only migration runner.
 *
 * Applies every .sql file in migrations/ in filename order, once, recording
 * what it applied. Small enough to read in a minute, which is the argument
 * for it over a framework on a project this size.
 *
 * Three properties worth having, and all three are easy to get wrong:
 *
 *  - Each migration runs inside a transaction, so a file that fails halfway
 *    leaves no partial schema behind.
 *  - An advisory lock serialises concurrent runners, so two instances
 *    starting together cannot both apply the same file.
 *  - Applied files are checksummed. Editing a migration that has already run
 *    makes environments silently diverge, so it is reported as an error.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closePool, pool } from './pool.js';
import { logger } from '../lib/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Any constant works; it only has to be the same in every process.
const LOCK_ID = 4_815_162_342;

interface AppliedRow {
  name: string;
  checksum: string;
}

function checksum(contents: string): string {
  return createHash('sha256').update(contents).digest('hex').slice(0, 16);
}

export async function migrate(): Promise<{ applied: string[] }> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        TEXT PRIMARY KEY,
        checksum    TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<AppliedRow>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const alreadyApplied = new Map(rows.map((row) => [row.name, row.checksum]));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const name of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
      const hash = checksum(sql);
      const previous = alreadyApplied.get(name);

      if (previous !== undefined) {
        if (previous !== hash) {
          throw new Error(
            `Migration ${name} has changed since it was applied ` +
              `(${previous} -> ${hash}). Migrations are forward-only: add a ` +
              `new file rather than editing one that has run.`,
          );
        }
        continue;
      }

      // Each file in its own transaction: one bad migration must not leave
      // the schema half-built.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, hash],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }

      applied.push(name);
      logger.info({ migration: name }, 'applied migration');
    }

    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    client.release();
  }
}

// Only run when invoked directly (`npm run migrate`), not when imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(({ applied }) => {
      logger.info(
        applied.length ? `applied ${applied.length} migration(s)` : 'schema up to date',
      );
      return closePool();
    })
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'migration failed');
      process.exit(1);
    });
}
