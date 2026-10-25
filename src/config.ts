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

import { z } from 'zod';

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
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}

export const config = load();
