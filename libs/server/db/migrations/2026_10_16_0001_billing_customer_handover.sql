-- #250: a group's provider customer belongs to the owner who checked out. A transfer of ownership
-- stamps `handed_over_at`: from then on the app opens no portal for that customer and the new owner
-- checks out with a customer of their own, so they never see the old owner's card, address or
-- invoices. The stamp goes when a new customer replaces the row.

ALTER TABLE billing_customers ADD COLUMN handed_over_at TIMESTAMPTZ;
