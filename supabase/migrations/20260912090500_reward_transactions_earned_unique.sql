-- Structural protection against two 'earned' reward_transactions on one order
--
-- NOT YET APPLIED.
--
-- Confirmed against production on 2026-09-12: zero existing duplicates
-- today, so creating this unique index will not fail or need any cleanup
-- first — this is purely forward-looking, structural protection.
--
-- finalize_reward_for_order() (20260908163528_finalize_reward_exclude_
-- workshop.sql) already guards the 'spent' transaction with
-- `ON CONFLICT (order_id) WHERE type='spent' DO NOTHING`, but the 'earned'
-- insert only has an application-level SELECT-then-INSERT check (`if found
-- ... else insert`) with no DB constraint behind it. In the current codebase
-- this function is only ever invoked from trg_order_reward_status_change
-- (one sequential call per row-level UPDATE, itself guarded by an OLD/NEW
-- transition check), so a real double-insert is unlikely today — but there
-- is no structural guarantee if the function is ever called from a second
-- entry point (e.g. an admin repair tool) or concurrently.
--
-- This migration adds the same protection 'spent' already has: a partial
-- unique index, so the database itself makes a second 'earned' row for the
-- same order impossible — not just "unlikely by construction elsewhere".

create unique index if not exists reward_transactions_order_earned_unique
  on public.reward_transactions (order_id)
  where type = 'earned' and order_id is not null;

-- finalize_reward_for_order(), updated to rely on the index instead of only
-- the SELECT-then-INSERT check (defence in depth: the SELECT check is kept —
-- it is what supplies v_earned when a row already exists — but the INSERT
-- itself is now guarded too, exactly like the 'spent' branch above it).
-- Every other line is IDENTICAL to 20260908163528_finalize_reward_exclude_
-- workshop.sql — same rate, same exclusion of workshop lines, same
-- RETURNS TABLE shape, same SECURITY DEFINER / search_path.
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
      )
      -- NEW: same structural guarantee as 'spent' above, backed by
      -- reward_transactions_order_earned_unique. A concurrent/duplicate call
      -- silently keeps the first row instead of erroring or double-crediting.
      on conflict (order_id)
        where type = 'earned' and order_id is not null
        do nothing;
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
