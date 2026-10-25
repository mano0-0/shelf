# shelf

A small, complete REST API in TypeScript — JWT auth, an OpenAPI 3.1 contract
generated from the validation schemas, and PostgreSQL.

The domain is deliberately boring: a personal library. Nobody is impressed by a
book tracker, which is the point — the subject matter is not what this is for.
It is small enough to read in one sitting and complete enough that nothing
important is stubbed.

## Run it

```bash
cp .env.example .env          # then set JWT_SECRET: openssl rand -hex 32
npm install
docker compose up -d          # PostgreSQL on 5433
npm run migrate
npm run dev
```

```bash
curl localhost:3000/health
curl localhost:3000/openapi.json | jq '.paths | keys'
```

Tests need the same database running:

```bash
npm test          # 42 integration tests against real PostgreSQL
```

## Endpoints

| | | |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Exchange credentials for tokens |
| `POST` | `/api/auth/refresh` | Rotate the refresh token |
| `POST` | `/api/auth/logout` | End one session |
| `POST` | `/api/auth/logout-all` | End every session |
| `GET` | `/api/auth/me` | The authenticated user |
| `GET` | `/api/books` | List, filter, search, paginate |
| `POST` | `/api/books` | Add a book |
| `GET` | `/api/books/{id}` | Fetch one |
| `PATCH` | `/api/books/{id}` | Update some fields |
| `DELETE` | `/api/books/{id}` | Remove one |
| `GET` | `/api/books/stats` | Counts by status, average rating |

Full detail at `/openapi.json`.

## Decisions worth explaining

**The OpenAPI document is generated, not written.** Each shape is defined once
in Zod and used for three things: the TypeScript type, the runtime validation,
and the spec. A hand-written document beside the code it describes drifts — the
endpoint changes, the document does not, and the documentation quietly becomes
wrong. Deriving all three from one definition makes that impossible.

**Ownership is a `WHERE` clause, not a check after loading.** Every book query
carries `AND owner_id = $n`. Fetching the row and then comparing owners means
one forgotten comparison is a cross-tenant read — and that failure is invisible
in testing, because test users usually own everything they query.

**Another user's book is 404, not 403.** A 403 confirms the id exists, which
lets identifiers be enumerated. "Not yours" and "not there" are reported
identically.

**Login spends the same time on a wrong password and an unknown email.** The
shared `INVALID_CREDENTIALS` message is pointless if an unknown email returns
in 2ms and a wrong password in 60ms: response time becomes an
account-existence oracle. The unknown-email path hashes a throwaway string so
both cost the same.

**Refresh tokens rotate, and reuse revokes everything.** Using a refresh token
revokes it and issues a new one in the same transaction. Presenting an already
revoked token revokes every session for that user — either it was stolen and
the thief is using it, or the real client replayed one, and the server cannot
tell those apart, so it assumes theft.

That last one had a real bug, caught by a test: the revocation originally ran
*inside* the rotation transaction and then threw, which rolled back the
revocation it had just performed. The security response was silently
cancelling itself. A mocked database would not have modelled the rollback.

**Invariants live in the database as well as the code.** The schema has
`CHECK (rating IS NULL OR status = 'read')`, so a rated-but-unread row cannot
exist whoever writes it. The Zod schema states the same rule to produce a
field-level message; the constraint is what guarantees it.

**Unknown fields are rejected, not ignored.** `PATCH` with `{ "ratng": 5 }`
returns 400. Dropping it silently would return 200 for a write that never
happened.

**Tests use a real PostgreSQL.** Mocking the database mostly asserts that the
mock behaves as written. It cannot catch a mistyped column, a constraint
firing, or a cascade that does not do what the author assumed.

## Layout

```
src/
  config.ts          settings, validated at startup
  app.ts             the Express app (no listening -- tests mount this)
  server.ts          listening and graceful shutdown
  routes/            HTTP shape only
  services/          the rules
  repositories/      SQL, and row-to-domain mapping
  middleware/        auth, validation, errors
  schemas/           Zod definitions -> types, validation, OpenAPI
  openapi/           document generation
  lib/               passwords, tokens, errors, logging
  db/                pool, transactions, migration runner
migrations/          forward-only SQL
tests/               42 integration tests
```

Four layers, each with one job. A route never touches SQL; a repository never
throws an HTTP status.

## Notes

`JWT_SECRET` has no default. A fallback like `?? 'dev-secret'` is how a known
signing key reaches production, so the app refuses to start without one.

Migrations are forward-only and checksummed: editing one that has already run
is an error, because it makes environments silently diverge.

The Docker image is multi-stage and runs as a non-root user; no compiler, dev
dependencies or TypeScript source ship in it.

## Licence

MIT
