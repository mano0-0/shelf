import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests share one database, so they must not run concurrently: a
    // TRUNCATE in one file would wipe another file's fixtures mid-test.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://shelf:shelf@localhost:5433/shelf',
      JWT_SECRET: 'test-only-secret-at-least-32-characters-long',
      LOG_LEVEL: 'silent',
      // Rate limits would otherwise reject the later tests in a file.
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
    },
  },
});
