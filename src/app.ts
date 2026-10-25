/**
 * The Express application.
 *
 * Built as a function returning an app, with no listening and no side
 * effects, so tests can mount it with supertest without binding a port.
 * `server.ts` is the only place that listens.
 *
 * Middleware order matters here and is not incidental:
 *   request id -> security headers -> logging -> parsing -> rate limit
 *   -> routes -> not-found -> error handler
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound, requestId } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { bookRouter } from './routes/books.js';
import { isHealthy } from './db/pool.js';
import { openApiDocument } from './openapi/document.js';

export function createApp(): Express {
  const app = express();

  // Behind a proxy, express-rate-limit must be told to read the forwarded
  // address or every request appears to come from the proxy and shares one
  // bucket. One hop only: trusting the whole chain lets a client spoof the
  // header and dodge the limit entirely.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());

  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => (res.locals as { requestId?: string }).requestId ?? '',
      // Health checks every few seconds would otherwise dominate the log.
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // A body limit is a denial-of-service control: without it a client can
  // make the server buffer an arbitrarily large request.
  app.use(express.json({ limit: '64kb' }));

  app.use(
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' },
      },
    }),
  );

  /**
   * Liveness and readiness in one. Reports 503 when the database is
   * unreachable, so an orchestrator stops routing traffic to an instance
   * that cannot serve it rather than discovering that per request.
   */
  app.get('/health', (_req, res) => {
    void isHealthy().then((database) => {
      res.status(database ? 200 : 503).json({
        status: database ? 'ok' : 'degraded',
        database: database ? 'up' : 'down',
        uptime: Math.round(process.uptime()),
      });
    });
  });

  // The spec is generated from the same Zod schemas the routes validate
  // with, so it cannot describe an endpoint that does not exist.
  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument());
  });

  app.use('/api/auth', authRouter);
  app.use('/api/books', bookRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
