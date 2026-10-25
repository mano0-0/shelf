-- Initial schema.
--
-- Constraints are declared here rather than enforced only in application
-- code: the database is the last line of defence, and it is the one that
-- still holds when a second service, a migration script, or a person with a
-- psql prompt writes to these tables.

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Addresses differing only in case are the same address to a person, so they
-- must be the same address here. A plain UNIQUE would let 'A@b.com' and
-- 'a@b.com' both register.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE books (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
    author          TEXT NOT NULL CHECK (length(trim(author)) BETWEEN 1 AND 200),
    isbn            TEXT CHECK (isbn IS NULL OR isbn ~ '^[0-9Xx-]{10,17}$'),
    status          TEXT NOT NULL DEFAULT 'unread'
                        CHECK (status IN ('unread', 'reading', 'read')),

    -- A rating is only meaningful once a book has been read. Enforcing the
    -- pairing here means no code path can produce a rated-but-unread row.
    rating          SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT rating_requires_read
        CHECK (rating IS NULL OR status = 'read'),

    notes           TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
    finished_at     TIMESTAMPTZ,
    CONSTRAINT finished_at_requires_read
        CHECK (finished_at IS NULL OR status = 'read'),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One copy of a given title per shelf. Case- and whitespace-insensitive,
-- because "Dune" and "dune " are the same book to the person shelving it.
CREATE UNIQUE INDEX books_owner_title_author_key
    ON books (owner_id, lower(trim(title)), lower(trim(author)));

-- Every list endpoint filters by owner and orders by recency.
CREATE INDEX books_owner_created_idx ON books (owner_id, created_at DESC);
CREATE INDEX books_owner_status_idx  ON books (owner_id, status);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The hash, never the token. A stolen database backup should not hand
    -- over working sessions, which is the same reason passwords are hashed.
    token_hash      TEXT NOT NULL UNIQUE,

    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

-- Keep updated_at honest without every UPDATE having to remember it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER books_set_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
