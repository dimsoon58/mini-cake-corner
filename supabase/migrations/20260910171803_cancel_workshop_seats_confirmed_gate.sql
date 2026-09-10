-- cancel_workshop_seats — accept a mixed order whose physical part is still
-- pending
--
-- NOT YET APPLIED. Run AFTER 20260911120000_mixed_orders_immediate_capture.sql.
-- Pure CREATE OR REPLACE — reproduces 20260909120300's cancel_workshop_seats
-- verbatim, changing ONLY the order gate.
--
-- Old gate: v_order.order_validation = 'approved'.
-- New model: a MIXED order's workshop is confirmed + paid the moment the
-- payment is confirmed, but order_validation stays 'pending' until the admin
-- decides the cake part. A customer must still be able to cancel their (paid,
-- confirmed) workshop seat in the free window during that time.
-- New gate: order_validation = 'approved'  OR  workshop_confirmed_at IS NOT NULL.

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

  -- Idempotency: this exact cancel already applied -> return the existing log.
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
