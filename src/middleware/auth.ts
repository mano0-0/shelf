/**
 * Identifying and authorising the caller.
 *
 * `authenticate` verifies the access token and attaches the claims to the
 * request. `requireRole` checks those claims. They are separate because
 * authentication and authorisation answer different questions, and routes
 * frequently need the first without the second.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ForbiddenError, UnauthenticatedError } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';
import type { UserRole } from '../schemas/auth.js';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

// Make `req.user` known to TypeScript everywhere, rather than casting at
// each use site.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  // Compared case-insensitively: RFC 7235 says the scheme is case-insensitive
  // and real clients send "bearer".
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

/** Reject the request unless it carries a valid access token. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    next(new UnauthenticatedError('Missing bearer token'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, role: claims.role };
    next();
  } catch (error) {
    // verifyAccessToken already distinguishes expiry from invalidity.
    next(error);
  }
};

/**
 * Attach the user when a token is present, but allow the request through
 * when it is not. For endpoints whose response varies by caller without
 * requiring one.
 */
export const optionalAuthenticate: RequestHandler = (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (token) {
    try {
      const claims = verifyAccessToken(token);
      req.user = { id: claims.sub, role: claims.role };
    } catch {
      // A bad token on an optional route is treated as no token.
    }
  }
  next();
};

/** Require one of `roles`. Must be mounted after `authenticate`. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      // Reaching here means the route was wired without `authenticate`.
      // Failing closed turns that mistake into a 401 rather than an
      // accidentally public endpoint.
      next(new UnauthenticatedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }
    next();
  };
}

/** The authenticated user, or a 401-throwing failure if there is none. */
export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthenticatedError();
  return req.user;
}
