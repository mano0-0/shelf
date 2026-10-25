/**
 * Authentication endpoints.
 *
 * Routes stay declarative: validate, call a service, send the result. There
 * is no business logic here, so reading this file tells you the shape of the
 * API and nothing else -- which is the point.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { config } from '../config.js';
import { asyncHandler } from '../middleware/error.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as auth from '../services/auth.js';
import {
  LoginBody,
  RefreshBody,
  RegisterBody,
  type LoginInput,
  type RegisterInput,
} from '../schemas/auth.js';
import { UnauthenticatedError } from '../lib/errors.js';

/**
 * A tighter limit on the credential endpoints than on the API at large.
 * These are the ones worth brute-forcing, and a hundred attempts a minute
 * is plenty for a human but not for a script.
 */
const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Counting successes too would let one person's successful logins lock out
  // an office behind a shared NAT address.
  skipSuccessfulRequests: true,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' },
  },
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: RegisterBody }),
  asyncHandler(async (req, res) => {
    const result = await auth.register(req.body as RegisterInput);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validate({ body: LoginBody }),
  asyncHandler(async (req, res) => {
    const result = await auth.login(req.body as LoginInput);
    res.json(result);
  }),
);

authRouter.post(
  '/refresh',
  authLimiter,
  validate({ body: RefreshBody }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    res.json(await auth.refresh(refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validate({ body: RefreshBody }),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    await auth.logout(refreshToken);
    // 204 whether or not the token was live: see services/auth.logout.
    res.status(204).send();
  }),
);

authRouter.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const revoked = await auth.logoutEverywhere(currentUser(req).id);
    res.json({ revokedSessions: revoked });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await auth.getProfile(currentUser(req).id);
    // A valid token for a deleted account: the token outlives the row it
    // refers to, so this is reachable and must not 500.
    if (!user) throw new UnauthenticatedError('Account no longer exists');
    res.json(user);
  }),
);
