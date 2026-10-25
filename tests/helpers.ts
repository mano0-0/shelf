/**
 * Test setup.
 *
 * Tests run against a real PostgreSQL, not a mock. Mocking the database
 * mostly asserts that the mock behaves as written: it cannot catch a typo in
 * a column name, a constraint that fires, or an ON DELETE CASCADE that does
 * not do what the author assumed. Those are the bugs worth catching.
 */

import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

export const app: Express = createApp();

export async function setupDatabase(): Promise<void> {
  await migrate();
}

/**
 * Empty every table between tests.
 *
 * TRUNCATE rather than DELETE: it is faster, and RESTART IDENTITY keeps
 * sequences from drifting across a run. CASCADE follows the foreign keys so
 * the order of this list does not matter.
 */
export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE users, books, refresh_tokens RESTART IDENTITY CASCADE');
}

export async function teardown(): Promise<void> {
  await pool.end();
}

let counter = 0;

/** A unique email per call, so parallel tests cannot collide. */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}.${process.pid}.${counter}@example.com`;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  auth: { Authorization: string };
}

/** Register a user and return their tokens. */
export async function createUser(overrides: Partial<{
  email: string;
  password: string;
  displayName: string;
}> = {}): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'correct-horse-battery-staple';

  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password,
      displayName: overrides.displayName ?? 'Test Reader',
    })
    .expect(201);

  const body = response.body as {
    user: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  };

  return {
    id: body.user.id,
    email,
    password,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    auth: { Authorization: `Bearer ${body.tokens.accessToken}` },
  };
}

/** Add a book for `user` and return it. */
export async function createBook(
  user: TestUser,
  overrides: Partial<{ title: string; author: string; status: string }> = {},
): Promise<{ id: string; title: string; author: string; status: string }> {
  const response = await request(app)
    .post('/api/books')
    .set(user.auth)
    .send({
      title: overrides.title ?? 'Dune',
      author: overrides.author ?? 'Frank Herbert',
      ...(overrides.status ? { status: overrides.status } : {}),
    })
    .expect(201);

  return response.body as { id: string; title: string; author: string; status: string };
}

export { request };
