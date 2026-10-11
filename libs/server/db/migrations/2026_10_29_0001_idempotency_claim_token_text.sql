-- From 1.64.0 the idempotency store of spy4x/ts-libs fences a claim with a random token (16 bytes
-- as base64url) and no longer with a UUID, so the column holds text. Tokens that exist already keep
-- their value, as text, and a run that holds one can still complete or release its claim.
--
-- The default goes with the type: the store always writes its own token, and a default would make
-- one in SQL. Until the API restarts on 1.64.0, the process that was running before this migration
-- cannot complete or release a claim (`operator does not exist: text = uuid`), so this migration
-- and the API restart belong to one deploy: docs/handoff.md, "Running it".
--
-- Postgres rewrites the table under a lock; it holds at most seven days of keys.
ALTER TABLE idempotency_keys
    ALTER COLUMN claim_token DROP DEFAULT,
    ALTER COLUMN claim_token TYPE text USING claim_token::text;
