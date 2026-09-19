-- list_active_reward_reservations(): all of the CALLING customer's own live
-- reward reservations, for the loyalty/account page's "available vs reserved"
-- display.
--
-- APPLIED IN PRODUCTION (confirmed 2026-09-19 — this comment previously said
-- NOT YET APPLIED).
--
-- Unlike get_reward_reservation_for_order (one exact order, for Checkout's
-- "resume this payment" flow), this is the AGGREGATE view: a customer can
-- hold several 'reserved' rows at once (reward_reservations is unique on
-- order_id only, not per customer), so LoyaltyRewards.tsx needs the full
-- list/sum, not a single arbitrary row.
--
-- Enriched with a LEFT JOIN to orders so the frontend can distinguish, per
-- reservation:
--   * order_exists = false                        -> still mid-checkout,
--     nothing charged yet ("reserved for a payment in progress").
--   * order_exists = true, payment_status <> 'paid' (or no matching row
--     content beyond the join) -> should not normally happen (an orders row
--     without payment_status='paid' shouldn't hold a live reservation), kept
--     only for completeness/defensiveness.
--   * payment_status = 'paid'                      -> genuinely paid, simply
--     awaiting admin approval — reward_reservations.status is still
--     'reserved' at the SQL level (finalize_reward_for_order only fires on
--     order_validation='approved' AND payment_status='paid'), but the
--     customer must see "paid, awaiting validation", never "payment in
--     progress" — this column is exactly what lets the frontend make that
--     distinction without any change to finalize_reward_for_order itself.
--
-- Security: same pattern as get_reward_reservation_for_order — SECURITY
-- DEFINER, search_path pinned, auth.uid() read internally (never a caller-
-- supplied customer id), no rows for an unauthenticated caller, REVOKE
-- PUBLIC/anon, GRANT authenticated only.

create or replace function public.list_active_reward_reservations()
returns table (
  order_id        uuid,
  amount          numeric,
  expires_at      timestamptz,
  order_exists    boolean,
  payment_status  text,
  order_validation text
)
language sql
security definer
set search_path to 'public'
stable
as $function$
  select
    rr.order_id,
    rr.amount,
    rr.expires_at,
    (o.id is not null) as order_exists,
    o.payment_status,
    o.order_validation
  from public.reward_reservations rr
  left join public.orders o on o.id = rr.order_id
  where auth.uid() is not null
    and rr.customer_id = auth.uid()
    and rr.status = 'reserved';
$function$;

revoke all on function public.list_active_reward_reservations() from public;
revoke all on function public.list_active_reward_reservations() from anon;
grant execute on function public.list_active_reward_reservations() to authenticated;
