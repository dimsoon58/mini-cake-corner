-- Speeds up the admin "All orders" page (list-orders/index.ts), which sorts
-- every page load by created_at DESC (see its ORDER BY + .range() call) —
-- the orders table currently has an index on order_date (a completely
-- different column: the pickup/delivery date, not the row's creation time)
-- but none on created_at, so every load forces a full scan + sort instead
-- of a fast index-ordered read.
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo. Purely additive: a new index only,
-- no table/column/data change, no application code change required, zero
-- behaviour change other than speed. Safe to run at any time.

create index if not exists idx_orders_created_at on public.orders(created_at desc);
