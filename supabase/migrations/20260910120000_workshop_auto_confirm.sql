-- Public workshop auto-confirmation
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only.
--
-- A "public workshop" order = a checkout order whose ONLY items are
-- product = 'workshop' (a published session from public.workshop_sessions with
-- a date / time / price / capacity). It needs NO manual Accepter / Refuser:
--   seats available -> payment authorised -> claim_workshop_reservations_batch
--   secures the seats (row-locked, transactional) -> the payment is captured
--   -> reservations set to 'confirmed' -> order_validation = 'approved'
--   -> the customer gets a "booking confirmed" e-mail.
--
-- This ONLY changes workshop-only orders. Cake orders, mixed orders (cake +
-- workshop), quote requests and manual orders keep the existing
-- Accepter / Refuser flow untouched.
--
--   orders.workshop_confirmed_at  set once the auto-confirmation has fully
--                                 succeeded (PostFinance captured + reservations
--                                 'confirmed' + order_validation 'approved').
--                                 NULL => the side-effect sweep retries it.
--                                 Only ever set for workshop-only orders.

alter table public.orders
  add column if not exists workshop_confirmed_at timestamptz;

comment on column public.orders.workshop_confirmed_at is
  'Public workshop-only order auto-confirmed (payment captured + reservations confirmed + order_validation approved). NULL for every cake / mixed / manual order.';

-- Backfill: any historical workshop-only order that an admin already approved
-- was, in effect, auto-confirmed — stamp it so the sweep never touches it and
-- send-workshop-email reads the "confirmed" wording on a re-open.
update public.orders o
set workshop_confirmed_at = coalesce(o.workshop_confirmed_at, o.finalized_at, o.paid_at, o.created_at)
where o.workshop_confirmed_at is null
  and o.order_validation = 'approved'
  and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product = 'workshop')
  and not exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop');
