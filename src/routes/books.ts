/**
 * Shelf endpoints.
 *
 * Every route here is authenticated, and every one passes the caller's id
 * into the service. There is no endpoint that reads books without an owner.
 */

import { Router } from 'express';

import { asyncHandler } from '../middleware/error.js';
import { authenticate, currentUser } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as books from '../services/books.js';
import {
  BookIdParam,
  BookListQuery,
  CreateBookBody,
  UpdateBookBody,
  type BookListQuery as ListQuery,
  type CreateBookInput,
  type UpdateBookInput,
} from '../schemas/book.js';

export const bookRouter = Router();

// Mounted once for the whole router rather than repeated per route: a new
// endpoint added below is authenticated by default, not by remembering.
bookRouter.use(authenticate);

bookRouter.get(
  '/',
  validate({ query: BookListQuery }),
  asyncHandler(async (req, res) => {
    const result = await books.listBooks(
      currentUser(req).id,
      req.query as unknown as ListQuery,
    );
    res.json(result);
  }),
);

bookRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await books.getStats(currentUser(req).id));
  }),
);

bookRouter.post(
  '/',
  validate({ body: CreateBookBody }),
  asyncHandler(async (req, res) => {
    const book = await books.addBook(currentUser(req).id, req.body as CreateBookInput);
    // 201 with a Location header: the client gets the canonical URL of the
    // thing it just made without having to assemble it.
    res.status(201).location(`/api/books/${book.id}`).json(book);
  }),
);

bookRouter.get(
  '/:id',
  validate({ params: BookIdParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    res.json(await books.getBook(currentUser(req).id, id));
  }),
);

bookRouter.patch(
  '/:id',
  validate({ params: BookIdParam, body: UpdateBookBody }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const book = await books.updateBook(
      currentUser(req).id,
      id,
      req.body as UpdateBookInput,
    );
    res.json(book);
  }),
);

bookRouter.delete(
  '/:id',
  validate({ params: BookIdParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    await books.deleteBook(currentUser(req).id, id);
    res.status(204).send();
  }),
);
