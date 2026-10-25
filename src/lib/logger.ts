/**
 * Structured logging.
 *
 * JSON in production so a log aggregator can filter on fields; human-readable
 * when developing. Silent under test, so a passing run is not buried in noise.
 *
 * The redact list matters more than the format: a request logger that prints
 * whole headers will eventually print an Authorization header into a log
 * aggregator that many people can read.
 */

import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.password_hash',
      '*.token',
      '*.refreshToken',
      '*.refresh_token',
    ],
    censor: '[redacted]',
  },
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
