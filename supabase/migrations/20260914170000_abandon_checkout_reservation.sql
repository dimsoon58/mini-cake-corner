-- Atomic cleanup for a real customer-initiated checkout abandonment
-- (2026-09-14, review fix on abandon-checkout / commit dff8bd8).
--
-- Bug: abandon-checkout's Edge Function used to do the cleanup as several
-- SEPARATE network round-trips (delete pending_payments, then RPC
-- release_reward_reservation, then update profiles, then upsert
-- payment_attempts) with no shared transaction. If the delete succeeded but
-- release_reward_reservation then failed, the Edge Function still returned
-- status: "abandoned" — the frontend cleared the cart while the customer's
-- points stayed reserved with pending_payments already gone, i.e. no code
-- path left to ever notice or retry the release.
--
-- Fix: everything DB-side happens inside this ONE plpgsql function, so a
-- failure at any step rolls back the whole thing atomically — either
-- everything lands (pending_payments gone AND points released AND welcome
-- discount released AND the attempt logged) or nothing does. The Edge
-- Function may only report "abandoned" once this function itself reports
-- released = true.
--
-- Never touches create-postfinance-payment / confirm-postfinance-payment /
-- the PostFinance void-online call itself (that stays in the Edge Function,
-- external HTTP can't be part of a DB transaction) — this function is only
-- ever invoked AFTER the caller has already proven, via a real PostFinance
-- state check, that the transaction is dead (terminal failure, or
-- successfully voided and re-confirmed VOIDED).
--
-- Idempotency (the second bug found in review): release_reward_reservation()
-- does NOT delete the reward_reservations row — it leaves it behind with
-- status = 'released'. So a customer calling this a second time (after an
-- already-successful abandonment) finds pending_payments already gone AND a
-- reward_reservations row that still exists, just no longer 'reserved'.
-- That combination must be treated as "already fully cleaned up" and return
-- released = true (idempotent success), never attempt a second release and
-- never report anything as still outstanding.
create or replace function public.abandon_checkout_reservation(
  p_order_id uuid,
  p_customer_id uuid
)
returns table (
  released boolean,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending record;
  v_reservation record;
  v_owner_id uuid;
begin
  if p_order_id is null or p_customer_id is null then
    raise exception 'abandon_checkout_reservation: orderId and customerId are required';
  end if;

  -- Lock both rows (if they exist) for the rest of this transaction —
  -- a concurrent call (double-click, or a genuine race with the PostFinance
  -- webhook) blocks here until this transaction commits or rolls back,
  -- rather than racing on the same orderId.
  select * into v_pending
  from public.pending_payments
  where order_id = p_order_id
  for update;

  select * into v_reservation
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  -- Nothing left to abandon: no pending_payments row, and no ACTIVE
  -- ('reserved') reward reservation — either there never was one (a
  -- welcome-discount-only or full-price attempt) or a previous call already
  -- released it (status = 'released', row still present by design — see
  -- the header comment). Idempotent success, no ownership check needed:
  -- there is nothing here to protect or leak.
  if v_pending is null and (v_reservation is null or v_reservation.status <> 'reserved') then
    return query select true, 'already_clean';
    return;
  end if;

  -- Ownership — the reservation's own customer_id is authoritative; the
  -- pending_payments payload's customer_id is the fallback for a
  -- welcome-discount-only attempt with no reward_reservations row at all.
  v_owner_id := coalesce(
    v_reservation.customer_id,
    nullif(v_pending.payload -> 'order' ->> 'customer_id', '')::uuid
  );
  if v_owner_id is null or v_owner_id <> p_customer_id then
    raise exception 'abandon_checkout_reservation: order % does not belong to customer %', p_order_id, p_customer_id
      using errcode = 'P0001';
  end if;

  -- Never abandon a real, already-finalised order — re-checked here, inside
  -- the same transaction as the actual delete, so no race with the Edge
  -- Function's own earlier (separate round-trip) check can slip through.
  if exists (select 1 from public.orders where id = p_order_id) then
    return query select false, 'already_confirmed';
    return;
  end if;

  delete from public.pending_payments where order_id = p_order_id;

  -- Idempotent on its own (see header comment) — safe even if v_reservation
  -- is null (a welcome-discount-only attempt) or already 'released'.
  perform public.release_reward_reservation(p_order_id);

  -- Welcome-discount reservation — ONLY if it still points at THIS exact
  -- orderId (never a different, unrelated attempt for the same customer).
  update public.profiles
  set welcome_discount_reserved_order_id = null,
      welcome_discount_reserved_at = null
  where id = p_customer_id
    and welcome_discount_reserved_order_id = p_order_id;

  insert into public.payment_attempts (order_id, status, error_type, updated_at)
  values (p_order_id, 'payment_failed', 'checkout_abandoned_by_customer', now())
  on conflict (order_id) do update
    set status = excluded.status,
        error_type = excluded.error_type,
        updated_at = excluded.updated_at;

  return query select true, 'released';
end;
$$;

-- SECURITY DEFINER, writes profiles/pending_payments/reward_reservations/
-- payment_attempts regardless of the caller's own RLS — locked down to
-- service_role only (called exclusively from abandon-checkout's Edge
-- Function, which has already independently verified the caller's identity
-- and ownership before ever reaching this RPC).
revoke all on function public.abandon_checkout_reservation(uuid, uuid) from public;
revoke all on function public.abandon_checkout_reservation(uuid, uuid) from anon;
revoke all on function public.abandon_checkout_reservation(uuid, uuid) from authenticated;
grant execute on function public.abandon_checkout_reservation(uuid, uuid) to service_role;
