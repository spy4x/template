-- #428: an operator's actions on the newsletter, each an audit row on the operator.
-- 18 = removed an address from a list; `identifier` is the list and the masked address
--      (`news:j***@example.com`), never the address the removal erased.
-- 19 = mailed a pending address its confirm link again; `identifier` as for 18.
-- 20 = downloaded a list's addresses; `identifier` is the list and the row count (`news:12`).
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]))
        NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
