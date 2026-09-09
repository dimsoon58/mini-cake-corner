-- Payment resilience — Migration 4/5: LEGACY backfill
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER migrations
-- 20260909140100 + 20260909140200 (needs the new orders columns + RPCs) and
-- BEFORE deploying the new confirm-postfinance-payment / postfinance-webhook.
--
-- Every order created by the OLD flow has all the new columns NULL. Without
-- this backfill:
--   * a re-opened old /payment-success page would see finalized_at NULL and
--     re-drive finalisation;
--   * the new "retry the missing side-effects" logic would re-send Make /
--     the admin e-mail / the customer e-mail for orders that already got them
--     synchronously months ago.
--
-- The OLD confirm-postfinance-payment did everything synchronously in one
-- pass: it inserted order_items, fired the Make webhook, invoked notify-order
-- and the customer e-mail, then deleted pending_payments. So a historical
-- order is one that:
--
--   (a) finalized_at IS NULL                    -- not already in the new system
--   (b) order_failure_reason IS NULL            -- not a workshop-capacity abort
--       (those keep finalized_at NULL on purpose; the abort branch handles them)
--   (c) created_at < now() - interval '1 hour'  -- created well before this deploy.
--       The new flow finalises within seconds, so anything an hour old that
--       isn't finalised was made by the OLD flow. New orders created after the
--       deploy are all newer than now()-1h at migration time, so they are
--       never touched here.
--   (d) EXISTS (order_items for this order)     -- the OLD flow always inserted
--       items synchronously. An order with NO items an hour later is a broken
--       partial from the NEW system and must be left for the recovery path,
--       NOT stamped as done.
--
-- For every matching order we stamp all markers = created_at (a truthful,
-- stable "this happened long ago" timestamp), only where still NULL.

update public.orders o
set
  finalization_claimed_at = coalesce(o.finalization_claimed_at, o.created_at),
  finalized_at            = coalesce(o.finalized_at,            o.created_at),
  side_effects_retry_at   = coalesce(o.side_effects_retry_at,   o.created_at),
  side_effects_done_at    = coalesce(o.side_effects_done_at,    o.created_at),
  make_notified_at         = coalesce(o.make_notified_at,        o.created_at),
  admin_notified_at        = coalesce(o.admin_notified_at,       o.created_at),
  customer_email_sent_at   = coalesce(o.customer_email_sent_at,  o.created_at),
  workshop_email_sent_at   = coalesce(o.workshop_email_sent_at,  o.created_at)
where o.finalized_at is null
  and o.order_failure_reason is null
  and o.created_at < now() - interval '1 hour'
  and exists (select 1 from public.order_items oi where oi.order_id = o.id);

-- Report (does not fail the migration): any not-finalised order left behind
-- that is NOT a fresh one — worth a manual look before deploying the new code.
do $$
declare
  v_left int;
begin
  select count(*) into v_left
  from public.orders o
  where o.finalized_at is null
    and o.order_failure_reason is null
    and o.created_at < now() - interval '1 hour';
  if v_left > 0 then
    raise notice 'LEGACY backfill: % order(s) older than 1h are still not finalised (no order_items?). Inspect before deploy.', v_left;
  end if;
end $$;
