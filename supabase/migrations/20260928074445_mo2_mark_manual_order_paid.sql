-- MO2 — mark_manual_order_paid(): atomic "mark as paid" for an Admin
-- manual order.
--
-- Reuses the live workshop mechanism (finalize_manual_workshop_order →
-- claim_workshop_reservations_batch), exactly as the Make/Notion manual
-- flow does — no second reservation path. Everything runs in one
-- transaction: if a workshop session is full or closed, the claim raises
-- and NOTHING is changed (no reservation, order still unpaid).
--
-- Order of operations is deliberate: reservations are created and
-- confirmed BEFORE payment_status becomes 'paid', so no trigger ever sees a
-- paid order without its reservations.
--
-- Called only by the manage-manual-order Edge Function (service role,
-- admin session + PIN). Not callable by anon/authenticated.

create or replace function public.mark_manual_order_paid(
  p_order_id       uuid,
  p_payment_method text,
  p_payment_note   text default null,
  p_paid_at        timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_paid  public.orders%rowtype;
begin
  if p_payment_method is null
     or p_payment_method not in ('cash', 'twint', 'bank_transfer', 'card', 'other') then
    raise exception 'Invalid payment method: %', p_payment_method using errcode = '22023';
  end if;

  -- 1. Lock the order for the whole transaction.
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id using errcode = 'P0002';
  end if;

  -- 2. Checks.
  if v_order.created_via is distinct from 'admin' then
    raise exception 'Order % was not created from the Admin', v_order.order_number using errcode = 'P0010';
  end if;
  if v_order.is_draft then
    raise exception 'Order % is still a draft', v_order.order_number using errcode = 'P0011';
  end if;
  if v_order.order_validation = 'cancelled' or v_order.order_failure_reason is not null then
    raise exception 'Order % is cancelled', v_order.order_number using errcode = 'P0012';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'Order % is not awaiting payment (payment_status = %)',
      v_order.order_number, v_order.payment_status using errcode = 'P0013';
  end if;

  -- 3. Workshops: existing live mechanism (claims seats with an atomic
  --    capacity check, confirms them, sets fulfillment_type /
  --    physical_validation / workshop_confirmed_at). Raises if a session is
  --    full (P0004) or closed (P0003) → whole transaction rolled back.
  perform public.finalize_manual_workshop_order(p_order_id);

  -- 4. Only now: the order becomes paid.
  update public.orders
  set payment_status = 'paid',
      paid_at        = coalesce(p_paid_at, now()),
      payment_method = p_payment_method,
      payment_note   = nullif(btrim(coalesce(p_payment_note, '')), ''),
      paid_amount    = total_amount,
      last_edited_at = now()
  where id = p_order_id
  returning * into v_paid;

  return jsonb_build_object(
    'order_id',       v_paid.id,
    'order_number',   v_paid.order_number,
    'payment_status', v_paid.payment_status,
    'paid_at',        v_paid.paid_at,
    'paid_amount',    v_paid.paid_amount
  );
end;
$$;

revoke all on function public.mark_manual_order_paid(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mark_manual_order_paid(uuid, text, text, timestamptz) to service_role;

comment on function public.mark_manual_order_paid(uuid, text, text, timestamptz) is
  'Atomic mark-as-paid for an Admin manual order: workshops via finalize_manual_workshop_order (rolled back entirely if a session is full), then payment_status = paid.';
