-- Migration A — workshop becomes a product_type value.
--
-- Postgres does not allow a new enum value to be added and then used in the
-- same transaction, so this ALTER TYPE lives in its own migration, applied
-- BEFORE 20260908120100_workshop_order_items.sql.
--
-- NOT YET APPLIED — run manually on Supabase after review.

ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'workshop';
