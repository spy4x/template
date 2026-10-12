-- #141: a person signs in with Google or GitHub, and links and unlinks those methods.
-- 13 = a provider account became a way into this account; `identifier` is the key's method.
-- 14 = the person removed a sign-in method; `identifier` is the key's method.
ALTER TABLE auth_audits
    DROP CONSTRAINT auth_audits_event_type_check,
    ADD CONSTRAINT auth_audits_event_type_check
        CHECK (event_type = ANY (ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])) NOT VALID;
ALTER TABLE auth_audits VALIDATE CONSTRAINT auth_audits_event_type_check;
