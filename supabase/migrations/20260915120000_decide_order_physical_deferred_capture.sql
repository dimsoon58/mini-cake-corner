-- decide_order_physical — adapted for deferred capture (2026-09-15)
--
-- Restores authorize-then-capture-on-Accept (pre-04a6199 model), extended to
-- also cover workshop_only orders and mixed orders as ONE whole-order
-- decision (product decision "Option A" — no partial capture, no separate
-- cake/workshop decision within a mixed cart).
--
-- CALLING CONTRACT (unchanged): this function NEVER talks to PostFinance —
-- manage-order/index.ts calls it ONLY AFTER a real PostFinance capture
-- (Accept) or void (Refuse) has already succeeded. It purely records that
-- outcome atomically: locks the order + the action token, verifies the
-- order is still undecided, writes ONE decision (which fires
-- handle_order_reward_status_change() in the same transaction, unchanged),
-- finalises/releases the welcome-discount reservation, transitions every
-- workshop_reservations row of this order (pending -> confirmed / rejected),
-- and consumes the token.
--
-- WHAT CHANGED vs the previous (immediate-capture) version:
--   * workshop_only orders are no longer rejected with
--     'workshop-only orders have no admin decision' — every fulfilment type
--     now goes through the exact same decision.
--   * "is this order still undecided?" is now checked on order_validation
--     for workshop_only (physical_validation stays 'not_applicable' for it,
--     same convention as before) and on physical_validation for
--     cake_only/mixed (unchanged).
--   * the "workshop part not confirmed yet" guard for a mixed order is
--     REMOVED — there is no longer a separate, earlier workshop
--     confirmation step to wait for; Accept/Refuse decides everything at
--     once.
--   * payment_status is now written HERE for the first time (previously set
--     unconditionally to 'paid' at order-creation under immediate capture):
--     'paid' + paid_at on approve, 'cancelled' on reject — because the
--     Edge Function only reaches this RPC after the real capture/void
--     already happened.
--   * a MIXED reject now rejects the WHOLE order (order_validation
--     'rejected', same as cake_only) instead of keeping order_validation
--     'approved' with only physical_validation 'rejected' — Option A: no
--     partial decision, the workshop is never captured independently of the
--     cake any more, so refusing releases everything together.
--   * refund_status / refund_due_amount are no longer computed as
--     'to_refund' on reject — nothing was ever captured before this point,
--     so there is nothing to refund; they stay 'none' / 0. The existing
--     mark_refunded action (manage-order/index.ts) and refund_status enum
--     are left completely in place for the rare defensive case where
--     manage-order's own capture-state check finds the transaction already
--     COMPLETED on a Refuse (see that file) — untouched here.
--   * on approve, if the order has workshop items (workshop_only OR mixed),
--     workshop_confirmed_at is now stamped HERE (previously stamped by
--     confirmWorkshopPart() at payment-capture time — disabled, see
--     _shared/order-side-effects.ts) and set_workshop_reservations_status
--     is invoked in the SAME transaction — a direct intra-transaction call
--     (not a PostgREST rpc()), so its own service_role-only grant is
--     irrelevant here; both functions are SECURITY DEFINER, called from
--     one to the other exactly like a normal SQL function call.
--   * on reject, set_workshop_reservations_status('reject') releases every
--     'pending'/'confirmed' reservation of the order — immediately freeing
--     the seat(s) in get_workshop_availability(), unchanged elsewhere.
--
-- A retry of the WINNING request (same token, now used, order already
-- decided) still returns { already_decided: true, ... } instead of erroring.

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
  v_reward_only    boolean;
  v_new_ov         text;
  v_new_pv         text;
  v_wd_rows        integer;
  v_still_pending  boolean;
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

  -- "Still undecided?" — workshop_only has no physical_validation of its
  -- own (stays 'not_applicable' forever), so its decision lives on
  -- order_validation directly; cake_only/mixed keep using physical_validation,
  -- unchanged.
  v_still_pending := case
    when v_ft = 'workshop_only' then coalesce(v_order.order_validation, 'pending') = 'pending'
    else coalesce(v_order.physical_validation, 'pending') = 'pending'
  end;

  -- A used token: if the order is already decided, this is a retry of the
  -- winner — return the recorded decision (idempotent). Otherwise it is a
  -- genuine error.
  if v_token.used then
    if not v_still_pending then
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

  if not v_still_pending then
    raise exception 'order already %',
      case when v_ft = 'workshop_only' then v_order.order_validation else v_order.physical_validation end
      using errcode = 'P0010';
  end if;

  v_reward_only := v_order.postfinance_transaction_id = 'REWARD_ONLY';

  -- ── Write exactly one decision ───────────────────────────────────────
  if p_action = 'approve' then
    v_new_ov := 'approved';
    v_new_pv := case when v_ft = 'workshop_only' then 'not_applicable' else 'approved' end;

    update public.orders set
      order_validation     = 'approved',
      physical_validation  = v_new_pv,
      physical_decided_at  = case when v_ft = 'workshop_only' then physical_decided_at else now() end,
      payment_status        = 'paid',
      paid_at                = coalesce(paid_at, now())
    where id = p_order_id;

    if v_has_workshop then
      update public.orders set
        workshop_confirmed_at = coalesce(workshop_confirmed_at, now())
      where id = p_order_id;
      perform public.set_workshop_reservations_status(p_order_id, 'approve');
    end if;

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

  else  -- reject — Option A: whole-order decision, nothing partial.
    v_new_ov := 'rejected';
    v_new_pv := case when v_ft = 'workshop_only' then 'not_applicable' else 'rejected' end;

    update public.orders set
      order_validation     = 'rejected',
      physical_validation  = v_new_pv,
      physical_decided_at  = case when v_ft = 'workshop_only' then physical_decided_at else now() end,
      -- Nothing was ever captured before this point (deferred capture) — the
      -- authorization was voided by the caller before reaching here, so
      -- there is nothing to refund. 'cancelled' mirrors the pre-04a6199
      -- convention (the live payment_status enum has no dedicated "voided"
      -- value).
      payment_status        = case when v_reward_only then payment_status else 'cancelled' end,
      refund_status         = 'none',
      refund_due_amount     = 0
    where id = p_order_id;

    if v_has_workshop then
      perform public.set_workshop_reservations_status(p_order_id, 'reject');
    end if;

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
    'refund_status',      'none',
    'refund_due_amount',  0,
    'workshop_kept',      v_workshop_kept,
    'reward_only',        v_reward_only
  );
end;
$$;

revoke all on function public.decide_order_physical(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_order_physical(uuid, text, text) to service_role;
