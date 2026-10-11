-- #293: a personal API token that ends keeps its row for a while. `revoked_at` is set when the owner
-- revokes it, changes or resets the password, leaves or is removed from the group, or the group is
-- deleted; a revoked token never works again and is not listed or counted. The row, and with it the
-- hash, stays so that a later request with the token can be tied to its owner and audited; the
-- worker deletes it 30 days after `revoked_at`.
ALTER TABLE api_tokens ADD COLUMN revoked_at TIMESTAMPTZ;

-- 12 = a request with a token was refused: the token was revoked or expired, or it may not do what
-- was asked. Every token row's `identifier` now names the token: its id, group, access and name.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
