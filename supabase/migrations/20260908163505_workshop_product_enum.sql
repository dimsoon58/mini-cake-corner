-- workshop becomes a product_type value.
--
-- ALREADY APPLIED IN PRODUCTION (migration version 20260908163505). This file
-- exists only for migration-history parity — do NOT re-run it. `ADD VALUE IF
-- NOT EXISTS` makes it a no-op anyway.

ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'workshop';
