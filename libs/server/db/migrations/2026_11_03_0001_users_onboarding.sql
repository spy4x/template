-- #298: the first-steps checklist and the tour in the SPA. Both answers belong to the person, not
-- to a device, so they are kept here and follow the person to every device.
--
-- `onboarding_dismissed_at`: when the person closed the checklist; `NULL` while it still shows.
-- `onboarding_tour_seen_at`: when the person finished or skipped the tour; `NULL` while it is
-- still offered. Each is written once and never cleared.
--
-- Safe on a table with rows: two nullable columns with no default change the catalogue only.
ALTER TABLE users
  ADD COLUMN onboarding_dismissed_at TIMESTAMPTZ,
  ADD COLUMN onboarding_tour_seen_at TIMESTAMPTZ;
