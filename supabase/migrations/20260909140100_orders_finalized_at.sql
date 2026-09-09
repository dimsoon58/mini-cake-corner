-- Payment resilience — Migration 2/3: orders.finalized_at
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only:
-- one nullable column, fast metadata-only ADD COLUMN.
--
-- The serialization point for order FINALISATION (order_items insert + the
-- Make webhook + notify-order + the customer email). confirm-postfinance-
-- payment can now be entered by TWO strictly-concurrent callers — the
-- customer's /payment-success poll and the PostFinance webhook — for the same
-- order. orders.id (PK) already serialises the orders INSERT, but order_items
-- has no unique key, so without this a second caller that sees "0 order_items"
-- would run the whole finalisation a second time.
--
-- claim_order_finalization(order_id) does a single atomic
--   UPDATE orders SET finalized_at = now() WHERE id = ? AND finalized_at IS NULL
-- so exactly ONE caller ever gets to run insertOrderItemsAndFinalize().
-- A self-heal clause lets a retry take over if a previous claimer set
-- finalized_at but crashed before writing any order_items (see migration 3).

alter table public.orders
  add column if not exists finalized_at timestamptz;

comment on column public.orders.finalized_at is
  'Set once the order has been finalised (order_items inserted, Make + notify-order + customer email dispatched). The atomic claim that gates finalisation against concurrent poll + webhook callers. NULL until finalisation starts.';
