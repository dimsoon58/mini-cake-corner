-- public.finalize_reward_for_order(p_order_id uuid): exclude workshop lines
-- from cashback generation.
--
-- ALREADY APPLIED IN PRODUCTION (migration version 20260908163528). This file
-- exists only for migration-history parity — do NOT re-run it (CREATE OR
-- REPLACE is idempotent).
--
-- The function below is the CURRENT deployed definition, reproduced verbatim.
-- The ONLY functional change is the single line
--     and product <> 'workshop'
-- added to the v_products query. Nothing else is touched:
--   * the welcome-discount deduction, the reward-used deduction, the 0.035
--     rate and the trunc(..., 2), the reward_transactions inserts, the
--     reservation consumption, recompute_reward_balance(), the RETURNS TABLE
--     shape, SECURITY DEFINER / SET search_path — all identical.
--   * trg_sync_pickup_delivery_date / sync_pickup_delivery_date() — NOT touched.
--   * make_order_payment_status_change /
--     notify_make_order_payment_status_change() — NOT touched.
--
-- Effect: a workshop line never adds to v_products, so it generates no 3.5%
-- cashback. Welcome discount and reward-used are already excluded from
-- workshops upstream (create-postfinance-payment), so the greatest(..., 0)
-- base here stays consistent for mixed carts.

CREATE OR REPLACE FUNCTION public.finalize_reward_for_order(p_order_id uuid)
RETURNS TABLE(reward_used numeric, reward_earned numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_res public.reward_reservations%rowtype;
  v_products numeric(12,2) := 0;
  v_used numeric(12,2) := 0;
  v_earned numeric(12,2) := 0;
  v_existing_earned numeric(12,2);
  v_expiry timestamptz;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.customer_id is null then
    return query select 0::numeric, 0::numeric;
    return;
  end if;

  select coalesce(round(sum(total), 2), 0)
    into v_products
  from public.order_items
  where order_id = p_order_id
    and product <> 'workshop';

  select * into v_res
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if found and v_res.status = 'reserved' then
    v_used := v_res.amount;

    update public.reward_reservations
       set status = 'consumed',
           consumed_at = now(),
           updated_at = now()
     where order_id = p_order_id;

    insert into public.reward_transactions(
      customer_id,
      order_id,
      type,
      amount,
      remaining_amount,
      note
    )
    values (
      v_order.customer_id,
      p_order_id,
      'spent',
      v_used,
      0,
      'Reward used on order'
    )
    on conflict (order_id)
      where type = 'spent' and order_id is not null
      do nothing;

  elsif found and v_res.status = 'consumed' then
    v_used := v_res.amount;

  else
    v_used := coalesce(v_order.reward_amount_used, 0);

    if v_used > 0 then
      raise exception 'Order expects reward usage but no valid reservation exists';
    end if;
  end if;

  select amount into v_existing_earned
  from public.reward_transactions
  where order_id = p_order_id
    and type = 'earned'
  limit 1;

  if found then
    v_earned := v_existing_earned;
  else
    v_earned := trunc(
      greatest(
        v_products
        - coalesce(v_order.welcome_discount_amount, 0)
        - v_used,
        0
      ) * 0.035,
      2
    );

    if v_earned > 0 then
      v_expiry := now() + interval '1 year';

      insert into public.reward_transactions(
        customer_id,
        order_id,
        type,
        amount,
        remaining_amount,
        expires_at,
        note
      )
      values (
        v_order.customer_id,
        p_order_id,
        'earned',
        v_earned,
        v_earned,
        v_expiry,
        '3.5% loyalty reward earned on paid products'
      );
    end if;
  end if;

  update public.orders
     set reward_amount_used = v_used,
         reward_amount_earned = v_earned
   where id = p_order_id;

  perform public.recompute_reward_balance(v_order.customer_id);

  return query select v_used, v_earned;
end;
$function$;
