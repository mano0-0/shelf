import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  app,
  createUser,
  request,
  resetDatabase,
  setupDatabase,
  teardown,
  uniqueEmail,
} from './helpers.js';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(teardown);

describe('POST /api/auth/register', () => {
  it('creates an account and issues tokens', async () => {
    const email = uniqueEmail();
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-sufficiently-long-password', displayName: 'Ada' })
      .expect(201);

    expect(response.body.user).toMatchObject({ email, displayName: 'Ada', role: 'user' });
    expect(response.body.tokens.accessToken).toBeTruthy();
    expect(response.body.tokens.refreshToken).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: uniqueEmail(),
        password: 'a-sufficiently-long-password',
        displayName: 'Ada',
      })
      .expect(201);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('password_hash');
    expect(serialised).not.toContain('$argon2');
  });

  it('rejects a duplicate email regardless of case', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'a-sufficiently-long-password', displayName: 'Ada' })
      .expect(201);

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: email.toUpperCase(),
        password: 'a-sufficiently-long-password',
        displayName: 'Imposter',
      })
      .expect(409);

    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it.each([
    ['not-an-email', 'short', 'invalid email'],
    ['valid@example.com', 'tooshort', 'short password'],
  ])('rejects %s / %s (%s)', async (email, password) => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Ada' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  it('returns tokens for correct credentials', async () => {
    const user = await createUser();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(response.body.user.id).toBe(user.id);
    expect(response.body.tokens.accessToken).toBeTruthy();
  });

  it('accepts the email in any case', async () => {
    const user = await createUser();
    await request(app)
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password })
      .expect(200);
  });

  it('gives the same response for an unknown email and a wrong password', async () => {
    const user = await createUser();

    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('nobody'), password: 'some-long-password-here' })
      .expect(401);

    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'the-wrong-password-entirely' })
      .expect(401);

    // Distinguishing these would reveal which emails are registered.
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error).toEqual(
      expect.objectContaining({ code: 'INVALID_CREDENTIALS', message: unknown.body.error.message }),
    );
  });
});

describe('token lifecycle', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed or tampered token', async () => {
    const user = await createUser();
    const tampered = `${user.accessToken.slice(0, -4)}AAAA`;

    await request(app).get('/api/auth/me').set('Authorization', 'Bearer nonsense').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tampered}`).expect(401);
    await request(app).get('/api/auth/me').set('Authorization', user.accessToken).expect(401);
  });

  it('accepts a lowercase bearer scheme', async () => {
    const user = await createUser();
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `bearer ${user.accessToken}`)
      .expect(200);
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const user = await createUser();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(refreshed.body.refreshToken).not.toBe(user.refreshToken);

    // The rotated-away token is dead.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('revokes every session when a used refresh token is presented again', async () => {
    const user = await createUser();

    const second = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    // Replaying the first token signals theft; the family is revoked.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    // So the token issued in between no longer works either.
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
  });

  it('logs out one session', async () => {
    const user = await createUser();

    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('logging out an unknown token still succeeds', async () => {
    await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: 'a-token-that-was-never-issued' })
      .expect(204);
  });

  it('logs out everywhere', async () => {
    const user = await createUser();
    const other = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const response = await request(app)
      .post('/api/auth/logout-all')
      .set(user.auth)
      .expect(200);

    expect(response.body.revokedSessions).toBeGreaterThanOrEqual(2);

    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: other.body.tokens.refreshToken })
      .expect(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    const user = await createUser();
    const response = await request(app).get('/api/auth/me').set(user.auth).expect(200);
    expect(response.body).toMatchObject({ id: user.id, email: user.email, role: 'user' });
  });
});
