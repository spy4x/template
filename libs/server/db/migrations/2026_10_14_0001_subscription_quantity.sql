-- #205: a per-member plan bills one seat per member. `quantity` is the seats the provider last
-- reported the subscription bills; the worker compares it with the member count and changes the
-- subscription when they differ. Existing rows learn it from their next event.

ALTER TABLE subscriptions ADD COLUMN quantity INTEGER;
