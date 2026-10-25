import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  app,
  createBook,
  createUser,
  request,
  resetDatabase,
  setupDatabase,
  teardown,
} from './helpers.js';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(teardown);

describe('authentication is required', () => {
  it.each([
    ['get', '/api/books'],
    ['post', '/api/books'],
    ['get', '/api/books/stats'],
  ])('%s %s rejects an anonymous caller', async (method, path) => {
    await (request(app) as never as Record<string, (p: string) => { expect: (n: number) => Promise<unknown> }>)
      [method]!(path)
      .expect(401);
  });
});

describe('POST /api/books', () => {
  it('adds a book', async () => {
    const user = await createUser();
    const response = await request(app)
      .post('/api/books')
      .set(user.auth)
      .send({ title: 'Dune', author: 'Frank Herbert' })
      .expect(201);

    expect(response.body).toMatchObject({
      title: 'Dune',
      author: 'Frank Herbert',
      status: 'unread',
      rating: null,
      finishedAt: null,
    });
    expect(response.headers.location).toBe(`/api/books/${response.body.id}`);
  });

  it('trims whitespace', async () => {
    const user = await createUser();
    const response = await request(app)
      .post('/api/books')
      .set(user.auth)
      .send({ title: '  Dune  ', author: ' Frank Herbert ' })
      .expect(201);

    expect(response.body.title).toBe('Dune');
    expect(response.body.author).toBe('Frank Herbert');
  });

  it('rejects the same book twice on one shelf, ignoring case and spacing', async () => {
    const user = await createUser();
    await createBook(user, { title: 'Dune', author: 'Frank Herbert' });

    const response = await request(app)
      .post('/api/books')
      .set(user.auth)
      .send({ title: '  dune ', author: 'FRANK HERBERT' })
      .expect(409);

    expect(response.body.error.code).toBe('ALREADY_EXISTS');
  });

  it('lets two users shelve the same book', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createBook(alice, { title: 'Dune', author: 'Frank Herbert' });
    await createBook(bob, { title: 'Dune', author: 'Frank Herbert' });
  });

  it('rejects an empty title and an over-long one', async () => {
    const user = await createUser();
    await request(app).post('/api/books').set(user.auth)
      .send({ title: '   ', author: 'Someone' }).expect(400);
    await request(app).post('/api/books').set(user.auth)
      .send({ title: 'x'.repeat(301), author: 'Someone' }).expect(400);
  });
});

describe('ownership', () => {
  it("reports another user's book as 404, not 403", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const book = await createBook(alice);

    // 403 would confirm the id exists and let ids be enumerated.
    const response = await request(app)
      .get(`/api/books/${book.id}`)
      .set(bob.auth)
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it("will not update or delete another user's book", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const book = await createBook(alice);

    await request(app).patch(`/api/books/${book.id}`).set(bob.auth)
      .send({ title: 'Hijacked' }).expect(404);
    await request(app).delete(`/api/books/${book.id}`).set(bob.auth).expect(404);

    // Alice's copy is untouched.
    const still = await request(app).get(`/api/books/${book.id}`).set(alice.auth).expect(200);
    expect(still.body.title).toBe('Dune');
  });

  it("never lists another user's books", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createBook(alice, { title: 'Alice Book' });
    await createBook(bob, { title: 'Bob Book' });

    const response = await request(app).get('/api/books').set(alice.auth).expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].title).toBe('Alice Book');
  });
});

describe('PATCH /api/books/:id', () => {
  it('updates only the fields provided', async () => {
    const user = await createUser();
    const book = await createBook(user, { title: 'Dune', author: 'Frank Herbert' });

    const response = await request(app)
      .patch(`/api/books/${book.id}`)
      .set(user.auth)
      .send({ status: 'reading' })
      .expect(200);

    expect(response.body.status).toBe('reading');
    expect(response.body.author).toBe('Frank Herbert');
  });

  it('sets finishedAt when a book is marked read', async () => {
    const user = await createUser();
    const book = await createBook(user);

    const response = await request(app)
      .patch(`/api/books/${book.id}`)
      .set(user.auth)
      .send({ status: 'read' })
      .expect(200);

    expect(response.body.finishedAt).toBeTruthy();
  });

  it('refuses a rating on a book that is not read', async () => {
    const user = await createUser();
    const book = await createBook(user);

    const response = await request(app)
      .patch(`/api/books/${book.id}`)
      .set(user.auth)
      .send({ rating: 5 })
      .expect(409);

    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  it('accepts a rating together with status read', async () => {
    const user = await createUser();
    const book = await createBook(user);

    const response = await request(app)
      .patch(`/api/books/${book.id}`)
      .set(user.auth)
      .send({ status: 'read', rating: 5 })
      .expect(200);

    expect(response.body).toMatchObject({ status: 'read', rating: 5 });
  });

  it('clears the rating when a book stops being read', async () => {
    const user = await createUser();
    const book = await createBook(user);

    await request(app).patch(`/api/books/${book.id}`).set(user.auth)
      .send({ status: 'read', rating: 4 }).expect(200);

    const response = await request(app).patch(`/api/books/${book.id}`).set(user.auth)
      .send({ status: 'reading' }).expect(200);

    expect(response.body.rating).toBeNull();
    expect(response.body.finishedAt).toBeNull();
  });

  it('rejects an unknown field rather than ignoring it', async () => {
    const user = await createUser();
    const book = await createBook(user);

    // Silently dropping `ratng` would return 200 for a write that never
    // happened.
    const response = await request(app)
      .patch(`/api/books/${book.id}`)
      .set(user.auth)
      .send({ ratng: 5 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an empty patch and a bad rating', async () => {
    const user = await createUser();
    const book = await createBook(user);

    await request(app).patch(`/api/books/${book.id}`).set(user.auth).send({}).expect(400);
    await request(app).patch(`/api/books/${book.id}`).set(user.auth)
      .send({ status: 'read', rating: 9 }).expect(400);
  });

  it('rejects a non-uuid id with 400, not 404', async () => {
    const user = await createUser();
    await request(app).get('/api/books/not-a-uuid').set(user.auth).expect(400);
  });
});

describe('GET /api/books', () => {
  it('filters by status and searches title and author', async () => {
    const user = await createUser();
    await createBook(user, { title: 'Dune', author: 'Frank Herbert' });
    await createBook(user, { title: 'Emma', author: 'Jane Austen', status: 'read' });

    const read = await request(app).get('/api/books?status=read').set(user.auth).expect(200);
    expect(read.body.items).toHaveLength(1);
    expect(read.body.items[0].title).toBe('Emma');

    const byAuthor = await request(app).get('/api/books?q=austen').set(user.auth).expect(200);
    expect(byAuthor.body.items[0].title).toBe('Emma');

    const byTitle = await request(app).get('/api/books?q=dun').set(user.auth).expect(200);
    expect(byTitle.body.items[0].title).toBe('Dune');
  });

  it('paginates, reporting the full total', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i += 1) {
      await createBook(user, { title: `Book ${i}`, author: `Author ${i}` });
    }

    const response = await request(app)
      .get('/api/books?limit=2&offset=0')
      .set(user.auth)
      .expect(200);

    expect(response.body.items).toHaveLength(2);
    expect(response.body.total).toBe(5);
    expect(response.body.limit).toBe(2);
  });

  it('sorts by title ascending', async () => {
    const user = await createUser();
    await createBook(user, { title: 'Zebra', author: 'A' });
    await createBook(user, { title: 'Apple', author: 'B' });

    const response = await request(app)
      .get('/api/books?sort=title&order=asc')
      .set(user.auth)
      .expect(200);

    expect(response.body.items.map((b: { title: string }) => b.title)).toEqual([
      'Apple',
      'Zebra',
    ]);
  });

  it('rejects an out-of-range limit and an unknown sort key', async () => {
    const user = await createUser();
    await request(app).get('/api/books?limit=500').set(user.auth).expect(400);
    await request(app).get('/api/books?sort=; DROP TABLE books').set(user.auth).expect(400);
  });
});

describe('DELETE /api/books/:id', () => {
  it('removes a book, and is 404 the second time', async () => {
    const user = await createUser();
    const book = await createBook(user);

    await request(app).delete(`/api/books/${book.id}`).set(user.auth).expect(204);
    await request(app).delete(`/api/books/${book.id}`).set(user.auth).expect(404);
  });
});

describe('GET /api/books/stats', () => {
  it('counts by status and averages the ratings', async () => {
    const user = await createUser();
    const a = await createBook(user, { title: 'A', author: 'X' });
    const b = await createBook(user, { title: 'B', author: 'Y' });
    await createBook(user, { title: 'C', author: 'Z' });

    await request(app).patch(`/api/books/${a.id}`).set(user.auth)
      .send({ status: 'read', rating: 4 }).expect(200);
    await request(app).patch(`/api/books/${b.id}`).set(user.auth)
      .send({ status: 'read', rating: 2 }).expect(200);

    const response = await request(app).get('/api/books/stats').set(user.auth).expect(200);
    expect(response.body).toMatchObject({ total: 3, read: 2, unread: 1, averageRating: 3 });
  });
});
