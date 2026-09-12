-- Reward/workshop bugfix — concurrency correction (2026-09-12): move the
-- cash/reward cumulative-target calculation INSIDE a locked SQL transaction,
-- under the SAME reservation row lock as the seat-count bump, instead of
-- computing it in the calling Edge Function beforehand.
--
-- NOT YET APPLIED. Run AFTER 20260912100000_workshop_reward_columns.sql
-- (needs workshop_cancellation_log.reward_amount_due) and
-- 20260912100100_claim_workshop_reservations_reward.sql.
--
-- *** BACKWARD-COMPATIBLE ROLLOUT — READ BEFORE APPLYING ***
-- This migration is PURELY ADDITIVE: it introduces a NEW function,
-- cancel_workshop_seats_atomic(...), under a DISTINCT NAME. It does NOT
-- touch, replace, or drop the existing public.cancel_workshop_seats(text,
-- uuid, integer, text, numeric, text) — that 6-argument function stays
-- exactly as deployed today, fully working, for as long as the currently-
-- deployed cancel-workshop-seats Edge Function (which still calls it) keeps
-- calling it. This is deliberate: the Edge Function in production right now
-- uses the OLD 6-arg signature — applying a migration that removed or
-- replaced it before the NEW Edge Function (which calls
-- cancel_workshop_seats_atomic instead) is deployed would break every
-- workshop cancellation in the gap between the two deploys.
--
-- Correct rollout order (see the project's rollout notes for the full
-- checklist across every file this bugfix touches):
--   1. Apply this migration (and the others in this change set) — additive
--      only, the OLD function keeps working, zero behaviour change for the
--      currently-deployed Edge Function.
--   2. Deploy the NEW cancel-workshop-seats Edge Function (the one that
--      calls cancel_workshop_seats_atomic).
--   3. Test workshop cancellations end-to-end against production.
--   4. Only THEN apply the separate cleanup migration
--      (20260912100400_cancel_workshop_seats_atomic_cleanup.sql) that drops
--      the old 6-arg function — by that point nothing calls it any more.
-- At no point in this sequence is production ever without a RPC signature
-- matching whatever Edge Function is actually live.
--
-- WHY THE CALCULATION MOVED: the previous design had cancel-workshop-seats/
-- index.ts read prior workshop_cancellation_log rows and compute this
-- cancellation's cash/reward share BEFORE calling the seat-cancelling RPC —
-- i.e. before taking the reservation's row lock. Two concurrent cancellation
-- requests for the SAME reservation, with two DIFFERENT idempotency keys (so
-- neither is a retry of the other), could both read the SAME "seats
-- cancelled so far" and BOTH compute the SAME cumulative share — e.g. two
-- people cancelling 1 seat each of a 3-seat / CHF 194 reservation nearly
-- simultaneously could both compute CHF 64.67 instead of 64.67 then 64.66.
-- The Edge Function must never be the source of truth for this arithmetic;
-- only a lock held for the whole read-compute-write sequence can guarantee
-- it.
--
-- FIX: this function takes p_within_free_window (a pure date fact — is
-- "today" still >= 7 calendar days before the workshop? — computed in the
-- caller from wall-clock time, which needs no DB state and is NOT part of
-- the race) instead of a pre-computed p_refund_amount_requested /
-- p_refund_status. Everything financial (cash due, reward due, refund
-- status) is computed HERE, after acquiring `for update` on the reservation
-- row, from figures already on that same row (unit_price, purchased_seats,
-- reward_amount_used — all fixed at creation, never mutated) plus a SUM over
-- this reservation's own prior workshop_cancellation_log rows — a query that
-- can only ever see prior, already-COMMITTED cancellations of the SAME
-- reservation, because every write path to that log for this reservation
-- goes through this same locked function. A second concurrent call blocks on
-- the `for update` until the first one commits, then correctly sees the
-- first one's logged amounts before computing its own delta.
--
-- Untouched by this migration: every seat-math invariant (idempotency-by-
-- (reservation_id, idempotency_key), the confirmed/partially_cancelled gate,
-- the order-approved-or-workshop_confirmed_at gate, the active-seats check,
-- the cancelled/purchased status transition) — reproduced verbatim from the
-- existing cancel_workshop_seats (20260910171803_cancel_workshop_seats_
-- confirmed_gate.sql), which this new function sits alongside, not on top of.

create function public.cancel_workshop_seats_atomic(
  p_reference          text,
  p_reservation_id     uuid,
  p_seats_to_cancel    integer,
  p_idempotency_key    text,
  p_within_free_window boolean
)
returns public.workshop_cancellation_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res              public.workshop_reservations%rowtype;
  v_order            public.orders%rowtype;
  v_log              public.workshop_cancellation_log%rowtype;
  v_active           integer;
  v_status           text;
  v_cancelled_after  integer;
  v_cash_captured    numeric(12,2);
  v_cash_already     numeric(12,2);
  v_reward_already   numeric(12,2);
  v_cash_target      numeric(12,2);
  v_reward_target    numeric(12,2);
  v_cash_delta       numeric(12,2);
  v_reward_delta     numeric(12,2);
  v_refund_status    text;
begin
  if p_seats_to_cancel is null or p_seats_to_cancel <= 0 then
    raise exception 'seats_to_cancel must be a positive integer' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;

  -- ── Lock the reservation FIRST — every read/write below (including the
  -- financial calculation) happens under this ONE lock, held for the whole
  -- transaction. A concurrent call for the same reservation blocks here
  -- until this transaction commits or rolls back.
  select wr.* into v_res
  from public.workshop_reservations wr
  where (p_reservation_id is not null and wr.id = p_reservation_id)
     or (p_reference is not null and wr.workshop_reference = p_reference)
  for update;
  if not found then
    raise exception 'Workshop reservation not found' using errcode = 'P0002';
  end if;

  -- Idempotency: this exact cancel already applied -> return the existing
  -- log untouched (whatever it was originally computed as — never
  -- recomputed on a retry).
  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.reservation_id = v_res.id
    and l.idempotency_key = p_idempotency_key;
  if found then
    return v_log;
  end if;

  if v_res.status not in ('confirmed', 'partially_cancelled') then
    raise exception 'Reservation % is % — partial cancellation needs confirmed/partially_cancelled',
      v_res.workshop_reference, v_res.status using errcode = 'P0005';
  end if;
  select o.* into v_order from public.orders o where o.id = v_res.order_id;
  if not found
     or not (v_order.order_validation = 'approved'
             or v_order.workshop_confirmed_at is not null) then
    raise exception 'Order for reservation % is not confirmed', v_res.workshop_reference using errcode = 'P0006';
  end if;

  v_active := v_res.purchased_seats - v_res.cancelled_seats;
  if p_seats_to_cancel > v_active then
    raise exception 'Cannot cancel % seats: only % active', p_seats_to_cancel, v_active
      using errcode = 'P0003';
  end if;

  v_status := case
    when (v_active - p_seats_to_cancel) = 0 then 'cancelled'
    else 'partially_cancelled'
  end;
  v_cancelled_after := v_res.cancelled_seats + p_seats_to_cancel;

  -- ── Financial calculation — SAME lock, SAME transaction ────────────────
  -- "Already logged" can only reflect prior cancellations of THIS
  -- reservation that already committed: every insert into this log for this
  -- reservation_id happens inside this same locked section (in EITHER this
  -- function or the legacy cancel_workshop_seats — see the note below), so
  -- a second concurrent caller blocked above on `for update` is guaranteed
  -- to see every row a first caller committed before it, and none that it
  -- didn't.
  select coalesce(sum(refund_amount_requested), 0), coalesce(sum(reward_amount_due), 0)
    into v_cash_already, v_reward_already
  from public.workshop_cancellation_log
  where reservation_id = v_res.id;

  -- The only mechanism that can ever reduce what was actually captured for
  -- a workshop line below unit_price * purchased_seats is the reward
  -- deduction (verified directly in create-postfinance-payment: the welcome
  -- discount explicitly skips every workshop item and is never applied to
  -- one; the express surcharge is its own separate PostFinance line, never
  -- modifies a product line, and is computed excluding workshops entirely;
  -- there is no other discount/promo mechanism in that function). So the
  -- net cash actually captured for this reservation is exactly
  -- unit_price * purchased_seats - reward_amount_used.
  v_cash_captured := round(v_res.unit_price * v_res.purchased_seats - v_res.reward_amount_used, 2);

  if p_within_free_window then
    v_cash_target   := round(v_cash_captured * v_cancelled_after / v_res.purchased_seats, 2);
    v_reward_target := round(v_res.reward_amount_used * v_cancelled_after / v_res.purchased_seats, 2);
  else
    -- Outside the free-cancellation window: this call contributes NOTHING
    -- new (targets frozen at whatever was already logged) — no refund, no
    -- reward restoration for the newly-cancelled seats, but never claws
    -- back what an EARLIER, in-window cancellation of the same reservation
    -- already logged.
    v_cash_target   := v_cash_already;
    v_reward_target := v_reward_already;
  end if;

  v_cash_delta   := greatest(round(v_cash_target - v_cash_already, 2), 0);
  v_reward_delta := greatest(round(v_reward_target - v_reward_already, 2), 0);

  v_refund_status := case
    when not p_within_free_window then 'outside_window'
    when v_cash_delta > 0 then 'pending'
    else 'non_required'
  end;

  update public.workshop_reservations wr
  set cancelled_seats = v_cancelled_after,
      status          = v_status,
      updated_at      = now()
  where wr.id = v_res.id;

  insert into public.workshop_cancellation_log (
    reservation_id, idempotency_key, seats_cancelled,
    refund_amount_requested, refund_amount_completed, refund_status,
    reward_amount_due, reward_amount_restored
  ) values (
    v_res.id, p_idempotency_key, p_seats_to_cancel,
    v_cash_delta, 0, v_refund_status,
    v_reward_delta, 0
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) from public;
revoke execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) from anon;
revoke execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) from authenticated;
grant execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) to service_role;
