/**
 * Authentication request and response shapes.
 */

import { z } from 'zod';
import { registry, text, uuid } from './common.js';

export const UserRole = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const User = registry.register(
  'User',
  z.object({
    id: uuid,
    email: z.string().email(),
    displayName: z.string(),
    role: UserRole,
    createdAt: z.string().datetime(),
  }).openapi('User'),
);

export type User = z.infer<typeof User>;

/**
 * Registration.
 *
 * The password floor is length, not a composition rule. Mandatory symbols
 * and digits push people towards `Password1!` and towards reuse; length is
 * what actually resists guessing. The maximum exists because argon2 hashing
 * time grows with input, making an unbounded password a cheap way to burn
 * server CPU.
 */
export const RegisterBody = registry.register(
  'Register',
  z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12, 'Use at least 12 characters').max(200),
    displayName: text(1, 80),
  }).openapi('Register'),
);

export type RegisterInput = z.infer<typeof RegisterBody>;

export const LoginBody = registry.register(
  'Login',
  z.object({
    email: z.string().trim().toLowerCase().email(),
    // No length rules on login: the stored password predates any change to
    // them, and the error must not hint at the real password's shape.
    password: z.string().min(1),
  }).openapi('Login'),
);

export type LoginInput = z.infer<typeof LoginBody>;

export const RefreshBody = registry.register(
  'Refresh',
  z.object({ refreshToken: z.string().min(1) }).openapi('Refresh'),
);

export const TokenPair = registry.register(
  'TokenPair',
  z.object({
    accessToken: z.string().openapi({ description: 'Short-lived. Send as `Authorization: Bearer <token>`.' }),
    refreshToken: z.string().openapi({ description: 'Long-lived. Exchange at /auth/refresh. Rotated on every use.' }),
    expiresIn: z.number().int().openapi({ description: 'Access token lifetime in seconds.' }),
  }).openapi('TokenPair'),
);

export const AuthResponse = registry.register(
  'AuthResult',
  z.object({ user: User, tokens: TokenPair }).openapi('AuthResult'),
);
