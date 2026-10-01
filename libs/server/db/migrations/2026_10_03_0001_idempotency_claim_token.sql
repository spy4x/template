-- The idempotency store of spy4x/ts-libs fences each claim with a token: `complete` and `release`
-- change a row only while they hold the token that claimed it, so a run whose claim was taken over
-- after its lease ran out can no longer overwrite the new run's result.
--
-- Rows that exist already get a random token; a run still in flight from before this migration
-- finishes without a matching token and its claim expires with the lease.
ALTER TABLE idempotency_keys ADD COLUMN claim_token UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE idempotency_keys ALTER COLUMN claim_token DROP DEFAULT;
