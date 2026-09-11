-- Capture the production hotfix to decide_order_physical() — variable typing
--
-- NOT YET APPLIED.
--
-- UPDATE 2026-09-12: v_new_ov's type is now CONFIRMED against production
-- directly (not inferred) — public.order_validation_status exists, and
-- decide_order_physical() really does declare
-- `v_new_ov public.order_validation_status`. The ⚠️ below is narrowed to the
-- one remaining unconfirmed detail: v_new_pv.
--
-- ⚠️ v_new_pv (physical_validation) is left as `text` below because no
-- equivalent type name was ever given/confirmed for it. If production also
-- types that one as an enum (e.g. a physical_validation_status type), this
-- file is INCOMPLETE and must be corrected before being applied — confirm
-- with `select pg_get_functiondef('public.decide_order_physical(uuid,text,text)'::regprocedure);`
-- against production first.
--
-- What follows is the EXACT business logic of 20260910171833_decide_order_
-- physical.sql, UNCHANGED, with only v_new_ov retyped to
-- public.order_validation_status as confirmed.
--
-- MANDATORY BEFORE APPLYING:
--   1. Confirm v_new_pv's real type (text, or an enum — see ⚠️ above).
--   2. Diff this function body against the real production definition
--      (pg_get_functiondef, as above) line by line — the TYPE of v_new_ov is
--      confirmed, but the rest of the body was reconstructed from the
--      tracked 20260910171833 version, not copied from production; confirm
--      no other difference exists before applying.
--   3. Only then apply.
--
-- Until applied, production keeps running on whatever hotfix is already
-- live — this migration changes nothing until it is deliberately run. This
-- migration does NOT create the public.order_validation_status type itself
-- (it already exists in production) — only CREATE OR REPLACEs the function.

create or replace function public.decide_order_physical(
  p_order_id uuid,
  p_token    text,
  p_action   text            -- 'approve' | 'reject'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order          public.orders%rowtype;
  v_token          public.order_action_tokens%rowtype;
  v_ft             text;
  v_has_workshop   boolean := false;
  v_has_physical   boolean := false;
  v_workshop_kept  numeric(10,2) := 0;
  v_total          numeric(10,2);
  v_refund_due     numeric(10,2);
  v_reward_only    boolean;
  v_new_ov         public.order_validation_status;  -- ⚠️ unverified type — see header
  v_new_pv         text;
  v_refund_status  text;
  v_wd_rows        integer;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action %', p_action using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  select * into v_token
  from public.order_action_tokens
  where order_id = p_order_id and token = p_token
  for update;
  if not found then
    raise exception 'invalid or unknown action token' using errcode = 'P0007';
  end if;

  -- Fulfilment shape.
  select
    coalesce(bool_or(oi.product =  'workshop'), false),
    coalesce(bool_or(oi.product <> 'workshop'), false),
    coalesce(round(sum(oi.total) filter (where oi.product = 'workshop'), 2), 0)
  into v_has_workshop, v_has_physical, v_workshop_kept
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_ft := coalesce(v_order.fulfillment_type, case
    when v_has_workshop and v_has_physical then 'mixed'
    when v_has_workshop then 'workshop_only'
    else 'cake_only'
  end);

  -- A used token: if the order is already decided, this is a retry of the
  -- winner — return the recorded decision (idempotent). Otherwise it is a
  -- genuine error.
  if v_token.used then
    if coalesce(v_order.physical_validation, 'pending') <> 'pending' then
      return jsonb_build_object(
        'already_decided',    true,
        'fulfillment_type',   v_ft,
        'order_validation',   v_order.order_validation,
        'physical_validation', v_order.physical_validation,
        'refund_status',      v_order.refund_status,
        'refund_due_amount',  v_order.refund_due_amount,
        'workshop_kept',      v_workshop_kept
      );
    end if;
    raise exception 'action token already used' using errcode = 'P0008';
  end if;

  if v_ft = 'workshop_only' then
    raise exception 'workshop-only orders have no admin decision' using errcode = 'P0009';
  end if;

  if coalesce(v_order.physical_validation, 'pending') <> 'pending' then
    raise exception 'physical part already %', v_order.physical_validation using errcode = 'P0010';
  end if;

  if v_ft = 'mixed' and v_order.workshop_confirmed_at is null then
    raise exception 'workshop part not confirmed yet' using errcode = 'P0011';
  end if;

  -- ── Refund amount + invariants ────────────────────────────────────────
  v_total := coalesce(v_order.total_amount, 0);
  v_reward_only := v_order.postfinance_transaction_id = 'REWARD_ONLY';
  v_refund_due := case
    when v_ft = 'mixed' then round(v_total - v_workshop_kept, 2)
    else round(v_total, 2)
  end;

  if v_refund_due is null
     or not (v_refund_due = v_refund_due)              -- NaN guard
     or v_refund_due < 0
     or v_refund_due > v_total + 0.001 then
    raise exception 'refund invariant violation: due=% total=% (ft=%)',
      v_refund_due, v_total, v_ft using errcode = 'P0012';
  end if;

  if v_ft = 'mixed' and not (v_has_workshop and v_has_physical) then
    raise exception 'mixed order % is missing a workshop or a physical line', p_order_id
      using errcode = 'P0013';
  end if;

  -- ── Write exactly one decision ───────────────────────────────────────
  if p_action = 'approve' then
    v_new_ov := 'approved';
    v_new_pv := 'approved';
    v_refund_status := coalesce(v_order.refund_status, 'none');

    update public.orders set
      order_validation    = 'approved',
      physical_validation  = 'approved',
      physical_decided_at  = now()
    where id = p_order_id;

    -- Finalise (consume) the welcome-discount reservation. This runs exactly
    -- once (a retry short-circuits on the used token above), so the UPDATE MUST
    -- match exactly one profile row whose reservation points at THIS order —
    -- otherwise the discount state is inconsistent and the whole decision is
    -- rolled back (never accept an order on an inconsistent discount).
    if coalesce(v_order.welcome_discount_amount, 0) > 0 and v_order.customer_id is not null then
      update public.profiles set
        welcome_discount_available = false,
        welcome_discount_used_at   = now()
      where id = v_order.customer_id
        and welcome_discount_reserved_order_id = p_order_id;
      get diagnostics v_wd_rows = row_count;
      if v_wd_rows <> 1 then
        raise exception
          'welcome discount reservation inconsistent for order % on approve (matched % row(s), expected 1)',
          p_order_id, v_wd_rows using errcode = 'P0014';
      end if;
    end if;

  else  -- reject
    v_new_pv := 'rejected';
    v_new_ov := case when v_ft = 'mixed' then 'approved' else 'rejected' end;
    v_refund_status := case when v_reward_only then 'none' else 'to_refund' end;

    update public.orders set
      order_validation    = v_new_ov,
      physical_validation  = 'rejected',
      physical_decided_at  = now(),
      refund_status        = v_refund_status,
      refund_due_amount    = case when v_reward_only then 0 else v_refund_due end
    where id = p_order_id;

    -- Release the welcome-discount reservation (make it available again). Same
    -- guarantee as approve: runs exactly once, so it MUST match exactly one
    -- profile row still pointing at this order — otherwise roll back.
    if coalesce(v_order.welcome_discount_amount, 0) > 0 and v_order.customer_id is not null then
      update public.profiles set
        welcome_discount_reserved_order_id = null,
        welcome_discount_reserved_at       = null
      where id = v_order.customer_id
        and welcome_discount_reserved_order_id = p_order_id;
      get diagnostics v_wd_rows = row_count;
      if v_wd_rows <> 1 then
        raise exception
          'welcome discount reservation inconsistent for order % on reject (matched % row(s), expected 1)',
          p_order_id, v_wd_rows using errcode = 'P0014';
      end if;
    end if;
  end if;

  -- Consume the token — same transaction.
  update public.order_action_tokens set used = true, used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'already_decided',    false,
    'fulfillment_type',   v_ft,
    'order_validation',   v_new_ov,
    'physical_validation', v_new_pv,
    'refund_status',      case when p_action = 'reject' and not v_reward_only then 'to_refund' else 'none' end,
    'refund_due_amount',  case when p_action = 'reject' and not v_reward_only then v_refund_due else 0 end,
    'workshop_kept',      v_workshop_kept,
    'reward_only',        v_reward_only
  );
end;
$$;

revoke all on function public.decide_order_physical(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_order_physical(uuid, text, text) to service_role;
