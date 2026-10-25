/**
 * Registration, login, refresh and logout.
 *
 * Services hold the rules. They talk to repositories and to the token and
 * password helpers, and they throw domain errors -- they never see a request
 * or a response object, which is what lets them be tested directly.
 */

import { transaction } from '../db/pool.js';
import {
  InvalidCredentialsError,
  UnauthenticatedError,
} from '../lib/errors.js';
import {
  hashPassword,
  needsRehash,
  verifyPassword,
  wasteTime,
} from '../lib/passwords.js';
import { logger } from '../lib/logger.js';
import {
  accessTokenLifetimeSeconds,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../lib/tokens.js';
import * as users from '../repositories/users.js';
import type { LoginInput, RegisterInput, User } from '../schemas/auth.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: User;
  tokens: TokenPair;
}

async function issueTokens(user: User): Promise<TokenPair> {
  const { token, hash } = createRefreshToken();
  await users.storeRefreshToken(user.id, hash, refreshTokenExpiry());

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: token,
    expiresIn: accessTokenLifetimeSeconds(),
  };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  // createUser translates the unique violation into a ConflictError, so the
  // duplicate-email case needs no check here.
  const user = await users.createUser({
    email: input.email,
    passwordHash,
    displayName: input.displayName,
  });

  logger.info({ userId: user.id }, 'user registered');
  return { user, tokens: await issueTokens(user) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const found = await users.findCredentialsByEmail(input.email);

  if (!found) {
    // Hash anyway. Returning early here would make an unknown email
    // measurably faster than a wrong password, which turns response time
    // into an account-existence oracle and undoes the shared error message.
    await wasteTime();
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword(found.passwordHash, input.password);
  if (!ok) throw new InvalidCredentialsError();

  // Transparently upgrade hashes made with older, weaker parameters. This is
  // the only moment the plaintext is available to do it.
  if (needsRehash(found.passwordHash)) {
    await users.updatePasswordHash(found.user.id, await hashPassword(input.password));
    logger.info({ userId: found.user.id }, 'password hash upgraded');
  }

  logger.info({ userId: found.user.id }, 'user logged in');
  return { user: found.user, tokens: await issueTokens(found.user) };
}

/**
 * Exchange a refresh token for a new pair, rotating it.
 *
 * The old token is revoked in the same transaction that issues the new one,
 * so a crash between the two cannot leave the caller with no usable token
 * and the row still live.
 *
 * Presenting an already-revoked token revokes the whole family. That is the
 * standard reuse-detection response: either the token was stolen and the
 * thief is now using it, or the legitimate client replayed one -- and from
 * the server's side those are indistinguishable, so it assumes theft.
 */
export async function refresh(presented: string): Promise<TokenPair> {
  const presentedHash = hashRefreshToken(presented);

  // Reuse detection runs before, and outside, the rotation transaction.
  // Revoking inside it and then throwing would roll back the revocation --
  // the transaction cannot both abort the request and persist the response
  // to it.
  const existing = await users.findRefreshToken(presentedHash);
  if (existing && existing.revoked_at !== null) {
    await users.revokeAllForUser(existing.user_id);
    logger.warn(
      { userId: existing.user_id },
      'revoked refresh token presented; revoking all sessions for this user',
    );
    throw new UnauthenticatedError('Refresh token has been revoked');
  }

  return transaction(async (client) => {
    const stored = await users.findRefreshToken(presentedHash, client);
    if (!stored) throw new UnauthenticatedError('Invalid refresh token');

    // Re-checked inside the transaction: two concurrent refreshes with the
    // same token must not both succeed.
    if (stored.revoked_at !== null) {
      throw new UnauthenticatedError('Refresh token has been revoked');
    }

    if (stored.expires_at.getTime() <= Date.now()) {
      throw new UnauthenticatedError('Refresh token has expired');
    }

    const user = await users.findById(stored.user_id);
    if (!user) throw new UnauthenticatedError('Account no longer exists');

    await users.revokeRefreshToken(stored.id, client);

    const { token, hash } = createRefreshToken();
    await users.storeRefreshToken(user.id, hash, refreshTokenExpiry(), client);

    return {
      accessToken: signAccessToken({ sub: user.id, role: user.role }),
      refreshToken: token,
      expiresIn: accessTokenLifetimeSeconds(),
    };
  });
}

/**
 * Log out one session.
 *
 * Succeeds whether or not the token was valid: a caller trying to end a
 * session should never be told their token was already dead, and there is
 * nothing useful they could do with that information anyway.
 */
export async function logout(presented: string): Promise<void> {
  const stored = await users.findRefreshToken(hashRefreshToken(presented));
  if (stored && stored.revoked_at === null) {
    await users.revokeRefreshToken(stored.id);
    logger.info({ userId: stored.user_id }, 'user logged out');
  }
}

/** Log out every session for a user -- after a password change, say. */
export async function logoutEverywhere(userId: string): Promise<number> {
  const revoked = await users.revokeAllForUser(userId);
  logger.info({ userId, revoked }, 'all sessions revoked');
  return revoked;
}

export async function getProfile(userId: string): Promise<User | undefined> {
  return users.findById(userId);
}
