/**
 * Access and refresh tokens.
 *
 * Two kinds, because they answer different questions:
 *
 *   access   a short-lived signed JWT. Carries the user id and role, so
 *            checking it needs no database round trip -- which is the whole
 *            point, and also why it cannot be revoked before it expires.
 *            Hence 15 minutes.
 *
 *   refresh  a long-lived opaque random string, stored hashed. Checking it
 *            does hit the database, so it can be revoked immediately. It is
 *            rotated on every use.
 *
 * The pairing is the usual trade-off: fast, unrevokable checks on the hot
 * path, and a slow revocable one on the rare path.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { config } from '../config.js';
import { TokenExpiredError, UnauthenticatedError } from './errors.js';
import type { UserRole } from '../schemas/auth.js';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
}

const ISSUER = 'shelf';
const AUDIENCE = 'shelf-api';

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    // HS256 pinned explicitly. Accepting whatever the token's own header
    // asks for is the classic JWT confusion bug.
    algorithm: 'HS256',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (typeof payload === 'string' || !payload.sub) {
      throw new UnauthenticatedError('Malformed token');
    }
    return { sub: payload.sub, role: (payload as jwt.JwtPayload).role as UserRole };
  } catch (error) {
    // Expiry is reported distinctly so a client knows to refresh rather than
    // to send the user back to the login screen.
    if (error instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
    if (error instanceof UnauthenticatedError) throw error;
    throw new UnauthenticatedError('Invalid token');
  }
}

/** Seconds until an access token expires, for the `expiresIn` field. */
export function accessTokenLifetimeSeconds(): number {
  const match = /^(\d+)([smhd])$/.exec(config.ACCESS_TOKEN_TTL);
  if (!match?.[1] || !match[2]) return 900;
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return amount * multiplier;
}

/**
 * A refresh token: 32 random bytes, and the hash to store alongside it.
 *
 * Opaque rather than a JWT because it must be revocable, and hashed in
 * storage for the same reason passwords are -- a leaked backup should not
 * contain working sessions. SHA-256 rather than argon2 is right here: the
 * input is already 256 bits of entropy, so there is nothing to brute-force
 * and no reason to pay argon2's cost on every refresh.
 */
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, so a match cannot be found byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function refreshTokenExpiry(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + config.REFRESH_TOKEN_TTL_DAYS);
  return expires;
}
