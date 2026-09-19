-- reserve_reward(): remove the unsafe local-only stale-reservation cleanup
--
-- APPLIED IN PRODUCTION (confirmed 2026-09-19 — this comment previously said
-- NOT YET APPLIED). Originally verified against production by the user
-- (2026-09-13) — the body below was the CURRENT deployed definition at that
-- time, reproduced verbatim, with EXACTLY ONE block removed and nothing else
-- touched:
--
--   for v_stale in
--     select rr.order_id
--     from public.reward_reservations rr
--     where rr.customer_id = p_customer_id
--       and rr.status = 'reserved'
--       and rr.expires_at <= now()
--       and not exists (select 1 from public.orders o where o.id = rr.order_id)
--       and not exists (
--         select 1 from public.pending_payments pp
--         where pp.order_id = rr.order_id
--           and pp.created_at > now() - interval '30 minutes'
--       )
--   loop
--     perform public.release_reward_reservation(v_stale);
--   end loop;
--
-- and the now-unused `v_stale uuid;` declaration.
--
-- WHY: this block released a stale reservation based ONLY on local state
-- (no orders row + no recent pending_payments row) — never a real PostFinance
-- status check. That local state is exactly what's ambiguous the moment
-- create-postfinance-payment has already POSTed to PostFinance but the
-- pending_payments write itself failed/was lost (network blip, crash) — a
-- real, narrow race, not hypothetical (see the payment-resilience audit,
-- 2026-09-13). In that race a genuinely live PostFinance transaction could
-- have its points silently freed by a totally unrelated customer action
-- (starting ANY other order), before any proof the original payment failed.
--
-- Cleanup of a stale/expired reservation is now handled EXCLUSIVELY by the
-- new reconcile-stale-reward-reservations Edge Function (scheduled via
-- pg_cron, see 20260913140300_schedule_reward_reservation_reconciliation.sql),
-- which never releases anything without first proving — via a real
-- merchantReference search against the PostFinance API — that no payable
-- transaction can still exist. reserve_reward() no longer does its own
-- opportunistic, unproven cleanup at all.
--
-- SAFE FOR ANTI-DOUBLE-SPEND: removing this block does not touch the
-- balance computation below it in any way. A stale, unreleased reservation
-- already holds its amount out of reward_transactions.remaining_amount from
-- the moment IT was created (the reservation mechanism's own, unchanged
-- invariant) — so v_available (read from profiles.reward_balance, itself
-- derived from remaining_amount via recompute_reward_balance) already
-- correctly excludes it, exactly as it did before. Removing this block only
-- removes an unproven, premature UN-hold of that amount; it can never cause
-- a NEW over-reservation. A customer whose old attempt is genuinely dead
-- simply sees the true (lower) available balance for the few minutes until
-- the reconciliation sweep proves it and releases it — never longer than
-- before in the case that mattered (a real abandonment), and never
-- incorrectly in the race case above.
--
-- Everything else in this function — the request validation, the existing-
-- reservation short-circuit (reserved/consumed/delete-and-retry), the
-- profile row lock, recompute_reward_balance calls, the reward_reservations
-- insert, the reward_transactions/reward_reservation_items FIFO allocation
-- loop, the insufficient-balance exception, RETURNS/SECURITY DEFINER/
-- search_path — is IDENTICAL to the deployed function, verbatim.

CREATE OR REPLACE FUNCTION public.reserve_reward(
  p_customer_id uuid,
  p_order_id uuid,
  p_requested_amount numeric,
  p_max_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_existing public.reward_reservations%rowtype;
  v_lot record;
  v_available numeric(12,2);
  v_target numeric(12,2);
  v_take numeric(12,2);
  v_remaining numeric(12,2);
begin
  if p_requested_amount is null or p_requested_amount < 1 or p_max_amount is null or p_max_amount <= 0 then
    return 0;
  end if;

  select * into v_existing
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if found then
    if v_existing.customer_id <> p_customer_id then
      raise exception 'Reward reservation belongs to another customer';
    end if;

    if v_existing.status = 'reserved' then
      return v_existing.amount;
    end if;

    if v_existing.status = 'consumed' then
      return v_existing.amount;
    end if;

    delete from public.reward_reservations
    where order_id = p_order_id;
  end if;

  perform 1
  from public.profiles
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'Customer profile not found';
  end if;

  perform public.recompute_reward_balance(p_customer_id);

  select reward_balance
  into v_available
  from public.profiles
  where id = p_customer_id;

  v_target := round(
    least(
      greatest(p_requested_amount, 0),
      greatest(p_max_amount, 0),
      greatest(v_available, 0)
    ),
    2
  );

  if v_target < 1 then
    return 0;
  end if;

  insert into public.reward_reservations(
    order_id,
    customer_id,
    amount,
    status,
    expires_at
  )
  values (
    p_order_id,
    p_customer_id,
    v_target,
    'reserved',
    now() + interval '30 minutes'
  );

  v_remaining := v_target;

  for v_lot in
    select id, remaining_amount
    from public.reward_transactions
    where customer_id = p_customer_id
      and type = 'earned'
      and remaining_amount > 0
      and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at, id
    for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_lot.remaining_amount, v_remaining);

    update public.reward_transactions
    set remaining_amount = round(remaining_amount - v_take, 2)
    where id = v_lot.id;

    insert into public.reward_reservation_items(
      order_id,
      reward_transaction_id,
      amount
    )
    values (
      p_order_id,
      v_lot.id,
      v_take
    );

    v_remaining := round(v_remaining - v_take, 2);
  end loop;

  if v_remaining > 0 then
    raise exception 'Insufficient reward balance during reservation';
  end if;

  perform public.recompute_reward_balance(p_customer_id);

  return v_target;
end;
$function$;
