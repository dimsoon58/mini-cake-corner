-- Workshop architecture — Migration 4/4: transactional RPCs
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER migrations
-- 1–3. Additive only. No existing function / trigger is modified. Nothing
-- outside the Workshop perimeter is touched (no PostFinance, welcome discount,
-- reward, finalize_reward_for_order, Make triggers).
--
--   claim_workshop_reservations_batch()  ALL workshop items of one order, one
--                                        transaction, all-or-nothing, idempotent
--   get_workshop_availability()          public read of live remaining seats
--   cancel_workshop_seats()              partial cancellation — seat math +
--                                        audit-log row (only for confirmed /
--                                        partially_cancelled reservations whose
--                                        order is already approved)
--   finalize_workshop_refund()           record the PostFinance refund outcome
--   set_workshop_reservations_status()   approve / reject lifecycle transition
--
-- All mutating RPCs: SECURITY DEFINER, search_path pinned, NOT granted to
-- anon / authenticated (service_role only, which bypasses the grant check).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Batch claim — one order, all its workshop items, one transaction
-- ══════════════════════════════════════════════════════════════════════════
-- p_items : jsonb array, one object per workshop order_item:
--   {
--     "order_item_id": "<uuid>",
--     "session_id": "sig-2026-10-03",
--     "seats": 2,
--     "unit_price": 85,
--     "workshop_type": "signature",
--     "item_comment": "…" | null,
--     "has_minor": true|false,
--     "minor_consent_confirmed": true|false
--   }
--
-- Behaviour:
--   * locks every referenced workshop_sessions row FOR UPDATE, in ASCENDING
--     session-id order (deterministic → no deadlock between concurrent orders);
--   * an order with several items for the SAME session has their seats summed
--     for that session's capacity check;
--   * idempotent on order_item_id: items already reserved are returned as-is
--     and excluded from the capacity maths (their seats are already counted in
--     "occupied"), so a retry never double-counts;
--   * if ANY session lacks capacity → raises (SQLSTATE 'P0004') and creates
--     NOTHING (all-or-nothing);
--   * on success, inserts the missing reservations (status 'pending') and
--     returns one row per input item: (order_item_id, workshop_reference,
--     reservation_id, status).
create or replace function public.claim_workshop_reservations_batch(
  p_order_id uuid,
  p_items    jsonb
)
returns table (
  order_item_id      uuid,
  workshop_reference text,
  reservation_id     uuid,
  status             text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item        jsonb;
  v_session_id  text;
  v_sess        record;
  v_existing    public.workshop_reservations%rowtype;
  v_needed      integer;
  v_occupied    integer;
  v_new         public.workshop_reservations%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'p_items must be a non-empty JSON array' using errcode = 'P0001';
  end if;

  -- ── Lock every distinct session, ascending id order (deadlock-safe) ──────
  for v_session_id in
    select distinct t.elem->>'session_id'
    from jsonb_array_elements(p_items) as t(elem)
    order by 1
  loop
    perform 1 from public.workshop_sessions where id = v_session_id for update;
    if not found then
      raise exception 'Unknown workshop session %', v_session_id using errcode = 'P0002';
    end if;
  end loop;

  -- ── Per distinct session: capacity check over the NEW (not-yet-reserved) seats ──
  for v_sess in
    select
      t.elem->>'session_id' as session_id,
      sum((t.elem->>'seats')::int) filter (
        where not exists (
          select 1 from public.workshop_reservations r
          where r.order_item_id = (t.elem->>'order_item_id')::uuid
        )
      ) as needed_seats
    from jsonb_array_elements(p_items) as t(elem)
    group by t.elem->>'session_id'
  loop
    v_needed := coalesce(v_sess.needed_seats, 0);
    if v_needed = 0 then
      continue; -- every item for this session already reserved (retry)
    end if;

    select coalesce(sum(wr.purchased_seats - wr.cancelled_seats), 0)
      into v_occupied
    from public.workshop_reservations wr
    where wr.workshop_session_id = v_sess.session_id
      and wr.status in ('pending', 'confirmed', 'partially_cancelled');

    if v_occupied + v_needed > (
      select max_capacity from public.workshop_sessions where id = v_sess.session_id
    ) then
      raise exception 'Workshop session % is full (occupied %, requested %)',
        v_sess.session_id, v_occupied, v_needed
        using errcode = 'P0004';
    end if;

    if not (select is_open from public.workshop_sessions where id = v_sess.session_id) then
      raise exception 'Workshop session % is closed', v_sess.session_id using errcode = 'P0003';
    end if;
  end loop;

  -- ── All capacities OK → create the missing reservations, return all ─────
  for v_item in select t.elem from jsonb_array_elements(p_items) as t(elem)
  loop
    select * into v_existing
    from public.workshop_reservations
    where workshop_reservations.order_item_id = (v_item->>'order_item_id')::uuid;

    if found then
      order_item_id      := v_existing.order_item_id;
      workshop_reference := v_existing.workshop_reference;
      reservation_id     := v_existing.id;
      status             := v_existing.status;
      return next;
      continue;
    end if;

    if (v_item->>'seats')::int <= 0 then
      raise exception 'seats must be a positive integer for order_item %', v_item->>'order_item_id'
        using errcode = 'P0001';
    end if;

    insert into public.workshop_reservations (
      workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type,
      purchased_seats, unit_price, item_comment, has_minor, minor_consent_confirmed, status
    ) values (
      public.generate_workshop_reference(),
      p_order_id,
      (v_item->>'order_item_id')::uuid,
      (v_item->>'session_id'),
      (v_item->>'workshop_type'),
      (v_item->>'seats')::int,
      (v_item->>'unit_price')::numeric,
      nullif(trim(coalesce(v_item->>'item_comment', '')), ''),
      coalesce((v_item->>'has_minor')::boolean, false),
      coalesce((v_item->>'minor_consent_confirmed')::boolean, false),
      'pending'
    )
    returning * into v_new;

    order_item_id      := v_new.order_item_id;
    workshop_reference := v_new.workshop_reference;
    reservation_id     := v_new.id;
    status             := v_new.status;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.claim_workshop_reservations_batch(uuid, jsonb) from public;
grant execute on function public.claim_workshop_reservations_batch(uuid, jsonb) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Public availability read
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.get_workshop_availability()
returns table (
  id                    text,
  workshop_type         text,
  workshop_date         date,
  workshop_time         text,
  unit_price            numeric,
  max_capacity          integer,
  is_open               boolean,
  active_reserved_seats integer,
  remaining_seats       integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.id,
    s.workshop_type,
    s.workshop_date,
    s.workshop_time,
    s.unit_price,
    s.max_capacity,
    s.is_open,
    coalesce(r.occupied, 0)::int                               as active_reserved_seats,
    greatest(s.max_capacity - coalesce(r.occupied, 0), 0)::int as remaining_seats
  from public.workshop_sessions s
  left join (
    select workshop_session_id,
           sum(purchased_seats - cancelled_seats) as occupied
    from public.workshop_reservations
    where status in ('pending', 'confirmed', 'partially_cancelled')
    group by workshop_session_id
  ) r on r.workshop_session_id = s.id
  order by s.workshop_date, s.workshop_time;
$$;

revoke all on function public.get_workshop_availability() from public;
grant execute on function public.get_workshop_availability() to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Partial cancellation — seat math + audit-log row (NO PostFinance here)
-- ══════════════════════════════════════════════════════════════════════════
-- Allowed ONLY when the reservation is 'confirmed' or 'partially_cancelled'
-- AND its order is already approved (order_validation = 'approved'). A still
-- 'pending' reservation cannot be partially cancelled — the admin must reject
-- the whole order and the customer re-books.
--
-- p_refund_status is decided by the caller (the Edge Function) from the
-- 7-calendar-day Europe/Zurich rule: 'pending' (refund to attempt) or
-- 'outside_window' (no refund). The actual refund outcome is written later by
-- finalize_workshop_refund().
-- Returns the workshop_cancellation_log row (new, or the existing one on an
-- idempotent replay). The caller re-reads workshop_reservations for the fresh
-- seat counts.
create or replace function public.cancel_workshop_seats(
  p_reference               text,
  p_reservation_id          uuid,
  p_seats_to_cancel         integer,
  p_idempotency_key         text,
  p_refund_amount_requested numeric,
  p_refund_status           text
)
returns public.workshop_cancellation_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res    public.workshop_reservations%rowtype;
  v_order  public.orders%rowtype;
  v_log    public.workshop_cancellation_log%rowtype;
  v_active integer;
  v_status text;
begin
  if p_seats_to_cancel is null or p_seats_to_cancel <= 0 then
    raise exception 'seats_to_cancel must be a positive integer' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;
  if p_refund_status not in ('pending', 'outside_window', 'non_required') then
    raise exception 'invalid p_refund_status %', p_refund_status using errcode = 'P0001';
  end if;

  select wr.* into v_res
  from public.workshop_reservations wr
  where (p_reservation_id is not null and wr.id = p_reservation_id)
     or (p_reference is not null and wr.workshop_reference = p_reference)
  for update;
  if not found then
    raise exception 'Workshop reservation not found' using errcode = 'P0002';
  end if;

  -- Idempotency: this exact cancel already applied → return the existing log.
  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.reservation_id = v_res.id
    and l.idempotency_key = p_idempotency_key;
  if found then
    return v_log;
  end if;

  -- Gate: only a confirmed / partially_cancelled reservation whose order is
  -- approved can be partially cancelled.
  if v_res.status not in ('confirmed', 'partially_cancelled') then
    raise exception 'Reservation % is % — partial cancellation needs confirmed/partially_cancelled',
      v_res.workshop_reference, v_res.status using errcode = 'P0005';
  end if;
  select o.* into v_order from public.orders o where o.id = v_res.order_id;
  if not found or v_order.order_validation is distinct from 'approved' then
    raise exception 'Order for reservation % is not approved', v_res.workshop_reference using errcode = 'P0006';
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

  update public.workshop_reservations wr
  set cancelled_seats = wr.cancelled_seats + p_seats_to_cancel,
      status          = v_status,
      updated_at      = now()
  where wr.id = v_res.id;

  insert into public.workshop_cancellation_log (
    reservation_id, idempotency_key, seats_cancelled,
    refund_amount_requested, refund_amount_completed, refund_status
  ) values (
    v_res.id, p_idempotency_key, p_seats_to_cancel,
    coalesce(p_refund_amount_requested, 0), 0, p_refund_status
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke all on function public.cancel_workshop_seats(text, uuid, integer, text, numeric, text) from public;
grant execute on function public.cancel_workshop_seats(text, uuid, integer, text, numeric, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Record the PostFinance refund outcome for a cancellation-log row
-- ══════════════════════════════════════════════════════════════════════════
-- p_refund_status: 'refunded' | 'failed' | 'outside_window' | 'non_required'
-- Only 'refunded' bumps workshop_reservations.refunded_amount, and only once
-- per log row (idempotent: a second call with the same terminal state is a
-- no-op).
create or replace function public.finalize_workshop_refund(
  p_log_id                uuid,
  p_refund_status         text,
  p_refund_amount_completed numeric,
  p_postfinance_refund_id text
)
returns public.workshop_cancellation_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_log public.workshop_cancellation_log%rowtype;
begin
  select * into v_log from public.workshop_cancellation_log where id = p_log_id for update;
  if not found then
    raise exception 'cancellation log % not found', p_log_id using errcode = 'P0002';
  end if;

  -- Already finalised to the same terminal state → no-op.
  if v_log.refund_status = p_refund_status and v_log.refund_status in ('refunded', 'outside_window', 'non_required') then
    return v_log;
  end if;

  if p_refund_status = 'refunded' and v_log.refund_status <> 'refunded' then
    update public.workshop_reservations
    set refunded_amount = refunded_amount + coalesce(p_refund_amount_completed, 0),
        updated_at      = now()
    where id = v_log.reservation_id;
  end if;

  update public.workshop_cancellation_log
  set refund_status           = p_refund_status,
      refund_amount_completed  = case when p_refund_status = 'refunded'
                                      then coalesce(p_refund_amount_completed, 0)
                                      else refund_amount_completed end,
      postfinance_refund_id    = coalesce(p_postfinance_refund_id, postfinance_refund_id),
      updated_at               = now()
  where id = p_log_id
  returning * into v_log;

  return v_log;
end;
$$;

revoke all on function public.finalize_workshop_refund(uuid, text, numeric, text) from public;
grant execute on function public.finalize_workshop_refund(uuid, text, numeric, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Approve / reject lifecycle transition for all of an order's reservations
-- ══════════════════════════════════════════════════════════════════════════
-- p_action: 'approve'  → pending → confirmed
--           'reject'   → pending|confirmed → rejected  (frees capacity)
-- Idempotent: re-running finds nothing to move and returns 0 rows changed.
create or replace function public.set_workshop_reservations_status(
  p_order_id uuid,
  p_action   text
)
returns setof public.workshop_reservations
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_action = 'approve' then
    return query
      update public.workshop_reservations
      set status = 'confirmed', updated_at = now()
      where order_id = p_order_id and status = 'pending'
      returning *;
  elsif p_action = 'reject' then
    return query
      update public.workshop_reservations
      set status = 'rejected', updated_at = now()
      where order_id = p_order_id and status in ('pending', 'confirmed')
      returning *;
  else
    raise exception 'invalid p_action %', p_action using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.set_workshop_reservations_status(uuid, text) from public;
grant execute on function public.set_workshop_reservations_status(uuid, text) to service_role;
