-- Workshop architecture — Migration 4/5: transactional RPCs
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER migrations
-- 20260909120000..20260909120200. Additive only. No existing function /
-- trigger is modified. Nothing outside the Workshop perimeter is touched.
--
--   claim_workshop_reservations_batch()  ALL workshop items of one order, one
--                                        transaction, all-or-nothing, idempotent,
--                                        DB-authoritative (nothing from client)
--   get_workshop_availability()          public read of live remaining seats
--   cancel_workshop_seats()              partial cancellation — seat math +
--                                        audit-log row (confirmed / partially
--                                        _cancelled reservations of an approved
--                                        order only)
--   finalize_workshop_refund()           record the PostFinance refund outcome
--   set_workshop_reservations_status()   approve / reject lifecycle transition
--
-- All mutating RPCs: SECURITY DEFINER, search_path pinned, revoked from PUBLIC
-- and granted to service_role only (the Edge Functions).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Batch claim — one order, all its workshop items, one transaction
-- ══════════════════════════════════════════════════════════════════════════
-- Takes ONLY p_order_id. Everything else is read from the DB:
--   * every public.order_items row of the order with product = 'workshop';
--   * its workshop_session_id / workshop_participants /
--     workshop_has_minor / workshop_minor_consent_confirmed;
--   * the session's workshop_type / unit_price / max_capacity / is_open from
--     public.workshop_sessions (the client price/type/date are NEVER trusted).
--
-- In one transaction:
--   * locks every referenced workshop_sessions row FOR UPDATE, ascending id
--     (deterministic → no deadlock between concurrent orders);
--   * items for the SAME session have their seats summed for the capacity check;
--   * idempotent on order_item_id — an already-reserved item is verified to
--     belong to this order + session, then returned as-is and excluded from
--     the capacity maths (its seats are already in "occupied");
--   * if ANY session lacks capacity / is closed → raises and creates NOTHING;
--   * has_minor = true requires minor_consent_confirmed = true;
--   * on success: inserts the missing reservations (status 'pending'),
--     generates the WS- reference AND writes it back onto public.order_items
--     in the SAME transaction (so a reservation without a reference can never
--     exist), returns one row per workshop item.
create or replace function public.claim_workshop_reservations_batch(
  p_order_id uuid
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
  v_sid      text;
  v_row      record;
  v_existing public.workshop_reservations%rowtype;
  v_needed   integer;
  v_occupied integer;
  v_new      public.workshop_reservations%rowtype;
  v_ref      text;
begin
  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
  ) then
    return; -- no workshop items — nothing to do
  end if;

  -- ── Lock every distinct session (ascending id), verify it exists ────────
  for v_sid in
    select distinct oi.workshop_session_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
    order by 1
  loop
    perform 1 from public.workshop_sessions where id = v_sid for update;
    if not found then
      raise exception 'Unknown workshop session % for order %', v_sid, p_order_id using errcode = 'P0002';
    end if;
  end loop;

  -- ── Per session: capacity check over the NOT-yet-reserved seats ─────────
  for v_row in
    select
      oi.workshop_session_id as session_id,
      sum(coalesce(oi.workshop_participants, 0)) filter (
        where not exists (
          select 1 from public.workshop_reservations r where r.order_item_id = oi.id
        )
      ) as needed_seats
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
    group by oi.workshop_session_id
  loop
    v_needed := coalesce(v_row.needed_seats, 0);
    if v_needed <= 0 then
      continue;
    end if;

    if not (select s.is_open from public.workshop_sessions s where s.id = v_row.session_id) then
      raise exception 'Workshop session % is closed', v_row.session_id using errcode = 'P0003';
    end if;

    select coalesce(sum(wr.purchased_seats - wr.cancelled_seats), 0)
      into v_occupied
    from public.workshop_reservations wr
    where wr.workshop_session_id = v_row.session_id
      and wr.status in ('pending', 'confirmed', 'partially_cancelled');

    if v_occupied + v_needed > (
      select s.max_capacity from public.workshop_sessions s where s.id = v_row.session_id
    ) then
      raise exception 'Workshop session % is full (occupied %, requested %)',
        v_row.session_id, v_occupied, v_needed
        using errcode = 'P0004';
    end if;
  end loop;

  -- ── All capacities OK → create the missing reservations ────────────────
  for v_row in
    select
      oi.id                                  as item_id,
      oi.workshop_session_id                 as session_id,
      coalesce(oi.workshop_participants, 0)  as seats,
      coalesce(oi.workshop_has_minor, false) as has_minor,
      coalesce(oi.workshop_minor_consent_confirmed, false) as consent,
      nullif(trim(coalesce(oi.item_comment, '')), '')     as note,
      s.workshop_type                        as db_type,
      s.unit_price                           as db_unit_price
    from public.order_items oi
    join public.workshop_sessions s on s.id = oi.workshop_session_id
    where oi.order_id = p_order_id and oi.product = 'workshop'
    order by oi.id
  loop
    -- Idempotency: existing reservation must belong to this order + session.
    select wr.* into v_existing
    from public.workshop_reservations wr
    where wr.order_item_id = v_row.item_id;

    if found then
      if v_existing.order_id <> p_order_id
         or v_existing.workshop_session_id <> v_row.session_id then
        raise exception 'Reservation for order_item % does not match order %/session %',
          v_row.item_id, p_order_id, v_row.session_id using errcode = 'P0008';
      end if;
      -- keep order_items.workshop_reference in sync on retry
      update public.order_items oi
      set workshop_reference = v_existing.workshop_reference
      where oi.id = v_row.item_id
        and oi.workshop_reference is distinct from v_existing.workshop_reference;

      order_item_id := v_existing.order_item_id;
      workshop_reference := v_existing.workshop_reference;
      reservation_id := v_existing.id;
      status := v_existing.status;
      return next;
      continue;
    end if;

    if v_row.seats < 1 then
      raise exception 'order_item % has no participants', v_row.item_id using errcode = 'P0001';
    end if;
    if v_row.has_minor and not v_row.consent then
      raise exception 'order_item %: minor participants declared without legal-representative consent',
        v_row.item_id using errcode = 'P0007';
    end if;

    v_ref := public.generate_workshop_reference();

    insert into public.workshop_reservations (
      workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type,
      purchased_seats, unit_price, item_comment, has_minor, minor_consent_confirmed, status
    ) values (
      v_ref, p_order_id, v_row.item_id, v_row.session_id, v_row.db_type,
      v_row.seats, v_row.db_unit_price, v_row.note, v_row.has_minor, v_row.consent, 'pending'
    )
    returning * into v_new;

    -- Same transaction: reference on the order_item, and re-align the stored
    -- workshop unit price / type with the DB source of truth.
    update public.order_items oi
    set workshop_reference   = v_ref,
        workshop_type        = v_row.db_type,
        workshop_unit_price  = v_row.db_unit_price,
        total                = round(v_row.db_unit_price * v_row.seats, 2)
    where oi.id = v_row.item_id;

    order_item_id := v_new.order_item_id;
    workshop_reference := v_new.workshop_reference;
    reservation_id := v_new.id;
    status := v_new.status;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.claim_workshop_reservations_batch(uuid) from public;
grant execute on function public.claim_workshop_reservations_batch(uuid) to service_role;

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
-- AND its order is already approved. A still 'pending' reservation cannot be
-- partially cancelled — the admin must reject the whole order.
--
-- Returns the workshop_cancellation_log row (new, or the existing one on an
-- idempotent replay).
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
-- p_refund_status: 'refunded' | 'failed' | 'pending' | 'outside_window' | 'non_required'
-- Only 'refunded' bumps workshop_reservations.refunded_amount, and only once
-- per log row.
create or replace function public.finalize_workshop_refund(
  p_log_id                  uuid,
  p_refund_status           text,
  p_refund_amount_completed numeric,
  p_postfinance_refund_id   text
)
returns public.workshop_cancellation_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_log public.workshop_cancellation_log%rowtype;
begin
  if p_refund_status not in ('refunded', 'failed', 'pending', 'outside_window', 'non_required') then
    raise exception 'invalid p_refund_status %', p_refund_status using errcode = 'P0001';
  end if;

  select l.* into v_log from public.workshop_cancellation_log l where l.id = p_log_id for update;
  if not found then
    raise exception 'cancellation log % not found', p_log_id using errcode = 'P0002';
  end if;

  -- Bump refunded_amount once, only on the first transition into 'refunded'.
  if p_refund_status = 'refunded' and v_log.refund_status <> 'refunded' then
    update public.workshop_reservations wr
    set refunded_amount = wr.refunded_amount + coalesce(p_refund_amount_completed, 0),
        updated_at      = now()
    where wr.id = v_log.reservation_id;
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
-- 'approve' → pending → confirmed ; 'reject' → pending|confirmed → rejected.
-- Idempotent: re-running moves nothing and returns 0 rows.
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
