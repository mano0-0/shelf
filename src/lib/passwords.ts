/**
 * Password hashing.
 *
 * argon2id, the current recommendation: it resists both GPU cracking and
 * side-channel attacks, which argon2i and argon2d each only half address.
 *
 * Never bcrypt-by-habit here -- bcrypt silently truncates at 72 bytes, so
 * two different long passwords can hash identically.
 */

import argon2 from 'argon2';

/**
 * Parameters from OWASP's Password Storage Cheat Sheet (19 MiB, t=2, p=1).
 *
 * The cost is stored inside the hash string, so raising these later does not
 * invalidate existing hashes: old passwords keep verifying against their own
 * recorded parameters, and `needsRehash` identifies the ones to upgrade.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row
 * should fail the login, not return a 500 that tells the caller the account
 * exists and is broken.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    // verify() reads the cost parameters from the stored hash itself, so
    // passing OPTIONS here is both unnecessary and a type error.
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** True when `hash` was made with weaker parameters than the current ones. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Spend roughly the same time as a real verification.
 *
 * Login hashes the submitted password even when the email does not exist.
 * Skipping that work makes "no such user" measurably faster than "wrong
 * password", which turns response time into an account-existence oracle --
 * the exact thing the shared InvalidCredentialsError message is there to
 * prevent.
 */
export async function wasteTime(): Promise<void> {
  await argon2.hash('timing-equalisation-placeholder', OPTIONS);
}
