/**
 * Configuration, validated once at startup.
 *
 * Every setting is read and checked here, so a missing or malformed value
 * stops the process immediately with a message naming the variable -- rather
 * than surfacing later as `undefined` somewhere deep in a request handler.
 *
 * In particular the JWT secret has no default. A development fallback like
 * `process.env.JWT_SECRET ?? 'dev-secret'` is how a known signing key reaches
 * production, so this refuses to start instead.
 */

import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { z } from 'zod';

/**
 * Load .env if present, before anything reads process.env.
 *
 * Node 20.12+ can do this without a dependency. Real environment variables
 * already set take precedence, so a deployed container's configuration is
 * never shadowed by a stray file in the image.
 */
if (existsSync('.env')) {
  try {
    loadEnvFile('.env');
  } catch {
    // A malformed .env should not stop the process: the validation below
    // will report precisely which variables are missing.
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required, e.g. postgres://user:pass@localhost:5432/shelf'),

  // No default, and long enough that a guessable value is rejected outright.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters; generate one with `openssl rand -hex 32`'),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  /** Comma-separated origins the browser may call this API from. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof EnvSchema> & {
  isProduction: boolean;
  isTest: boolean;
};

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // A configuration error is the first thing a newcomer hits, so say how
    // to fix it rather than only what is wrong.
    const hint = existsSync('.env')
      ? 'Check the values in .env against .env.example.'
      : [
          'No .env file found. To create one:',
          '',
          '  cp .env.example .env',
          '  echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env',
          '',
          'Then start the database with `docker compose up -d`.',
        ].join('\n');

    throw new Error(`Invalid environment configuration:\n${problems}\n\n${hint}`);
  }

  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}

export const config = load();
