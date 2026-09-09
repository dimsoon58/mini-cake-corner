-- Payment resilience — Migration 4/5: LEGACY backfill
--
-- NOT YET APPLIED — run manually on Supabase, AFTER 20260909140100 +
-- 20260909140200 and BEFORE deploying the new Edge Functions.
--
-- Every order from the OLD flow has all the new columns NULL. Without this
-- backfill a re-opened old /payment-success would try to re-finalise and the
-- new "retry the missing side-effects" logic would re-send Make / the admin
-- e-mail / the customer e-mail for orders that already got them months ago.
--
-- WHY NO TIME CUTOFF:
-- this migration runs BEFORE the new code is deployed, so EVERY order that
-- exists right now was created by the OLD (fully-synchronous) flow — including
-- one created 5 minutes ago. A `created_at < now() - 1 hour` rule would wrongly
-- skip those. The state of the order is what matters, not its age.
--
-- A historical order is one that:
--   (a) finalized_at IS NULL                 -- not already in the new system
--   (b) order_failure_reason IS NULL         -- not a workshop-capacity abort
--       (those keep finalized_at NULL on purpose; the abort branch handles them)
--   (c) EXISTS (order_items for this order)  -- the OLD flow always inserted
--       items synchronously. An order with NO items is a broken shell (it would
--       never have shown a success page) — left untouched for a human to check.
--
-- If you WANT a hard cutoff instead, uncomment the `and o.created_at < …` line
-- below with your FIXED deploy timestamp (never now()-based).

------------------------------------------------------------------------------
-- CONTROL — BEFORE
------------------------------------------------------------------------------
do $$
declare
  v_to_backfill int;
  v_stay_null   int;
begin
  select count(*) into v_to_backfill
  from public.orders o
  where o.finalized_at is null
    and o.order_failure_reason is null
    and exists (select 1 from public.order_items oi where oi.order_id = o.id);

  select count(*) into v_stay_null
  from public.orders o
  where o.finalized_at is null
    and o.order_failure_reason is null
    and not exists (select 1 from public.order_items oi where oi.order_id = o.id);

  raise notice 'LEGACY backfill — BEFORE: % order(s) will be backfilled; % order(s) will stay finalized_at NULL (no order_items).', v_to_backfill, v_stay_null;
end $$;

-- Detailed list of the orders that will NOT be backfilled (inspect these).
select o.id, o.order_number, o.created_at, o.payment_status, o.order_validation
from public.orders o
where o.finalized_at is null
  and o.order_failure_reason is null
  and not exists (select 1 from public.order_items oi where oi.order_id = o.id)
order by o.created_at desc;

------------------------------------------------------------------------------
-- BACKFILL
------------------------------------------------------------------------------
update public.orders o
set
  finalization_claimed_at    = coalesce(o.finalization_claimed_at,    o.created_at),
  finalized_at               = coalesce(o.finalized_at,               o.created_at),
  side_effects_retry_at      = coalesce(o.side_effects_retry_at,      o.created_at),
  side_effects_done_at       = coalesce(o.side_effects_done_at,       o.created_at),
  make_notified_at           = coalesce(o.make_notified_at,           o.created_at),
  make_webhook_dispatched_at = coalesce(o.make_webhook_dispatched_at, o.created_at),
  workshop_make_notified_at  = coalesce(o.workshop_make_notified_at,  o.created_at),
  admin_notified_at          = coalesce(o.admin_notified_at,          o.created_at),
  customer_email_sent_at     = coalesce(o.customer_email_sent_at,     o.created_at),
  workshop_email_sent_at     = coalesce(o.workshop_email_sent_at,     o.created_at)
where o.finalized_at is null
  and o.order_failure_reason is null
  and exists (select 1 from public.order_items oi where oi.order_id = o.id)
  -- and o.created_at < timestamptz '2026-09-09 00:00:00+02'   -- OPTIONAL fixed cutoff
;

------------------------------------------------------------------------------
-- CONTROL — AFTER
------------------------------------------------------------------------------
do $$
declare
  v_still_null int;
begin
  select count(*) into v_still_null
  from public.orders o
  where o.finalized_at is null
    and o.order_failure_reason is null;
  raise notice 'LEGACY backfill — AFTER: % order(s) still finalized_at NULL (all should be capacity-aborts or item-less shells).', v_still_null;
end $$;

-- Detailed list of every order still finalized_at NULL after the backfill.
select o.id, o.order_number, o.created_at, o.order_failure_reason,
       o.payment_status, o.order_validation,
       exists (select 1 from public.order_items oi where oi.order_id = o.id) as has_items
from public.orders o
where o.finalized_at is null
order by o.created_at desc;
