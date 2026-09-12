-- Reward/workshop bugfix, step 2/3: claim_workshop_reservations_batch also
-- copies order_items.reward_amount_used onto the new reservation.
--
-- NOT YET APPLIED. Run AFTER 20260912100000_workshop_reward_columns.sql.
--
-- Pure CREATE OR REPLACE — reproduces the CURRENT deployed body of
-- claim_workshop_reservations_batch (20260909120300_workshop_rpcs.sql)
-- verbatim. The ONLY functional changes:
--   1. the reservation-creation SELECT also reads oi.reward_amount_used
--      (defaults to 0 for every order today — the column is brand new).
--   2. the INSERT into workshop_reservations also sets reward_amount_used
--      from that value.
-- Seat math, capacity checks, idempotency, the order_items UPDATE
-- (workshop_reference / workshop_type / workshop_unit_price / total) are
-- ALL unchanged — order_items.total is still never touched by this
-- migration, exactly as before.

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
      s.unit_price                           as db_unit_price,
      -- NEW: how much of this line's total was paid with reward. Always 0
      -- until create-postfinance-payment's reward-allocation loop starts
      -- populating it (workshop-only orders only — see that function).
      coalesce(oi.reward_amount_used, 0)     as db_reward_amount_used
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
      purchased_seats, unit_price, item_comment, has_minor, minor_consent_confirmed, status,
      reward_amount_used
    ) values (
      v_ref, p_order_id, v_row.item_id, v_row.session_id, v_row.db_type,
      v_row.seats, v_row.db_unit_price, v_row.note, v_row.has_minor, v_row.consent, 'pending',
      v_row.db_reward_amount_used
    )
    returning * into v_new;

    -- Same transaction: reference on the order_item, and re-align the stored
    -- workshop unit price / type with the DB source of truth.
    -- order_items.total is UNCHANGED here — still unit_price * seats, exactly
    -- as before this migration. reward_amount_used is NOT touched on
    -- order_items either (it was already set by create-postfinance-payment
    -- before the order was even inserted); this UPDATE only re-derives the
    -- workshop pricing fields it always re-derived.
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
