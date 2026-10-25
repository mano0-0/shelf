/**
 * Process entry point: listen, and shut down cleanly.
 *
 * Graceful shutdown is the whole reason this is separate from app.ts. On
 * deploy the orchestrator sends SIGTERM and waits; a process that exits
 * immediately drops whatever it was mid-way through. This one stops
 * accepting connections, lets in-flight requests finish, closes the
 * database, and only then exits.
 */

import type { Server } from 'node:http';

import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function start(): Server {
  const app = createApp();

  const server = app.listen(config.PORT, () => {
    logger.info(
      { port: config.PORT, env: config.NODE_ENV },
      `shelf listening on http://localhost:${config.PORT}`,
    );
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    // A second signal during shutdown means someone is impatient; honour it.
    if (shuttingDown) {
      logger.warn('second signal received, exiting now');
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // A request that never completes must not hold the process open forever.
    const timer = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    server.close((error) => {
      if (error) logger.error({ err: error }, 'error closing server');
      closePool()
        .then(() => {
          logger.info('shutdown complete');
          process.exit(error ? 1 : 0);
        })
        .catch((poolError: unknown) => {
          logger.error({ err: poolError }, 'error closing database pool');
          process.exit(1);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // An unhandled rejection leaves the process in an unknown state. Logging
  // and exiting is safer than continuing to serve from it; the orchestrator
  // will restart a clean one.
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException');
  });

  return server;
}

start();
