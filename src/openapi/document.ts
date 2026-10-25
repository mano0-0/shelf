/**
 * The OpenAPI 3.1 document, generated from the Zod schemas.
 *
 * This is the reason the schemas are defined once. A spec written by hand
 * beside the code it describes is a spec that drifts: the endpoint changes,
 * the document does not, and the documentation quietly becomes wrong.
 * Generating it from the same schemas the routes validate with makes that
 * impossible -- if the validation changes, so does the document.
 */

import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { registry } from '../schemas/common.js';
import {
  AuthResponse,
  LoginBody,
  RefreshBody,
  RegisterBody,
  User,
} from '../schemas/auth.js';
import {
  Book,
  BookListQuery,
  BookListResponse,
  CreateBookBody,
  UpdateBookBody,
} from '../schemas/book.js';
import { ErrorResponse } from '../schemas/common.js';

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Access token from /api/auth/login or /api/auth/refresh.',
});

/** Shorthand for the error responses nearly every endpoint can return. */
function errors(...codes: number[]): Record<string, unknown> {
  const descriptions: Record<number, string> = {
    400: 'Request validation failed',
    401: 'Missing, invalid or expired token',
    403: 'Authenticated but not permitted',
    404: 'No such resource',
    409: 'Conflicts with the current state',
    429: 'Rate limit exceeded',
  };
  return Object.fromEntries(
    codes.map((code) => [
      String(code),
      {
        description: descriptions[code] ?? 'Error',
        content: { 'application/json': { schema: ErrorResponse } },
      },
    ]),
  );
}

const security = [{ [bearer.name]: [] }];

function registerPaths(): void {
  registry.registerPath({
    method: 'post',
    path: '/api/auth/register',
    summary: 'Create an account',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: RegisterBody } } } },
    responses: {
      201: {
        description: 'Account created; tokens issued',
        content: { 'application/json': { schema: AuthResponse } },
      },
      ...errors(400, 409, 429),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    summary: 'Exchange credentials for tokens',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: LoginBody } } } },
    responses: {
      200: {
        description: 'Authenticated',
        content: { 'application/json': { schema: AuthResponse } },
      },
      ...errors(400, 401, 429),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    summary: 'Exchange a refresh token for a new pair',
    description:
      'The presented token is revoked and replaced. Presenting an already-revoked '
      + 'token revokes every session for that user.',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: RefreshBody } } } },
    responses: {
      200: {
        description: 'New token pair',
        content: {
          'application/json': {
            schema: z.object({
              accessToken: z.string(),
              refreshToken: z.string(),
              expiresIn: z.number(),
            }),
          },
        },
      },
      ...errors(400, 401, 429),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    summary: 'Revoke one refresh token',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: RefreshBody } } } },
    responses: { 204: { description: 'Session ended' }, ...errors(400) },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout-all',
    summary: 'Revoke every session for the caller',
    tags: ['auth'],
    security,
    responses: {
      200: {
        description: 'Sessions revoked',
        content: {
          'application/json': { schema: z.object({ revokedSessions: z.number() }) },
        },
      },
      ...errors(401),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/auth/me',
    summary: 'The authenticated user',
    tags: ['auth'],
    security,
    responses: {
      200: { description: 'Profile', content: { 'application/json': { schema: User } } },
      ...errors(401),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/books',
    summary: 'List the caller’s books',
    tags: ['books'],
    security,
    request: { query: BookListQuery },
    responses: {
      200: {
        description: 'A page of books',
        content: { 'application/json': { schema: BookListResponse } },
      },
      ...errors(400, 401),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/books/stats',
    summary: 'Counts by status, and the average rating',
    tags: ['books'],
    security,
    responses: {
      200: {
        description: 'Shelf statistics',
        content: {
          'application/json': {
            schema: z.object({
              total: z.number(),
              unread: z.number(),
              reading: z.number(),
              read: z.number(),
              averageRating: z.number().nullable(),
            }),
          },
        },
      },
      ...errors(401),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/books',
    summary: 'Add a book',
    tags: ['books'],
    security,
    request: { body: { content: { 'application/json': { schema: CreateBookBody } } } },
    responses: {
      201: {
        description: 'Book added',
        content: { 'application/json': { schema: Book } },
      },
      ...errors(400, 401, 409),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/books/{id}',
    summary: 'Fetch one book',
    description:
      'A book belonging to another user is reported as 404, not 403, so ids '
      + 'cannot be enumerated.',
    tags: ['books'],
    security,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: { description: 'The book', content: { 'application/json': { schema: Book } } },
      ...errors(400, 401, 404),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/books/{id}',
    summary: 'Update some fields of a book',
    tags: ['books'],
    security,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: { content: { 'application/json': { schema: UpdateBookBody } } },
    },
    responses: {
      200: {
        description: 'The updated book',
        content: { 'application/json': { schema: Book } },
      },
      ...errors(400, 401, 404, 409),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/books/{id}',
    summary: 'Remove a book',
    tags: ['books'],
    security,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 204: { description: 'Removed' }, ...errors(400, 401, 404) },
  });
}

let registered = false;

export function openApiDocument(): object {
  // registerPath mutates the shared registry, so guard against a second call
  // producing duplicate entries.
  if (!registered) {
    registerPaths();
    registered = true;
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Shelf API',
      version: '0.1.0',
      description:
        'A small personal library API. Generated from the same Zod schemas the '
        + 'endpoints validate with, so this document cannot drift from the code.',
      license: { name: 'MIT' },
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local' }],
    tags: [
      { name: 'auth', description: 'Accounts and sessions' },
      { name: 'books', description: 'The caller’s shelf' },
    ],
  });
}

export { OpenAPIRegistry };
