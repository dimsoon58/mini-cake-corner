-- Workshop architecture — Migration 5/5: orders.order_failure_reason
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER migrations
-- 20260909120000..20260909120300. Additive only.
--
-- A dedicated, persistent marker for a checkout that authorised (or captured)
-- a payment but then could NOT be turned into a valid order — currently only
-- "workshop_capacity_unavailable": a workshop seat sold out between checkout
-- and payment confirmation, so the whole order was unwound.
--
-- confirm-postfinance-payment sets this and, on every later poll, the
-- existing-order path reads it and keeps returning the failure (so GA4
-- purchase never fires and the real reason is never lost). order_comment is
-- NOT reused for this.

alter table public.orders
  add column if not exists order_failure_reason text;

comment on column public.orders.order_failure_reason is
  'Non-null when a paid checkout could not become a valid order. Currently: ''workshop_capacity_unavailable''. NULL for every normal order.';
