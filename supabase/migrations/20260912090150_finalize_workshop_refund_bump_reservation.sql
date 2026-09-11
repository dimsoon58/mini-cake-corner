-- finalize_workshop_refund(): bump workshop_reservations.updated_at on
-- EVERY refund-related change, not only the transition into 'refunded'
--
-- NOT YET APPLIED. Depends on 20260912090100_workshop_reservation_make_
-- sync.sql (must be applied first — this migration only matters because
-- that one introduced the single "needs Make sync" signal below).
--
-- FOUND IN PRODUCTION (2026-09-12, correction round 4): the original
-- finalize_workshop_refund() (20260909120300_workshop_rpcs.sql) only bumps
-- workshop_reservations.updated_at inside the branch that bumps
-- refunded_amount — i.e. only on the FIRST transition into 'refunded'. Every
-- other call (a refund attempt recorded as 'pending', a later 'failed', a
-- postfinance_refund_id correction, or a 'refunded' call that is not the
-- first one) writes ONLY to workshop_cancellation_log and never touches
-- workshop_reservations at all.
--
-- This matters because the generalised Workshop -> Make sync (migration
-- 20260912090100) uses exactly ONE staleness signal for the whole
-- reservation:
--     make_notified_at IS NULL OR make_notified_at < updated_at
-- A refund-status change that never bumps updated_at is therefore
-- INVISIBLE to that signal — Make/Notion would silently keep showing a
-- stale "Remboursement" value (e.g. still "À rembourser" after a refund
-- actually failed, or after the reference number changed) with nothing to
-- ever notice or retry it.
--
-- FIX: every call to finalize_workshop_refund() now unconditionally bumps
-- workshop_reservations.updated_at, in addition to (unchanged)
-- workshop_cancellation_log.updated_at. A redundant Make sync when nothing
-- Notion-visible actually changed is harmless — the Make scenario is
-- Find -> Update/Create, idempotent on identical data. Missing one is not.
--
-- refunded_amount logic is UNCHANGED: still bumped once, only on the first
-- real transition into 'refunded'. The cancellation-log UPDATE
-- (refund_status / refund_amount_completed / postfinance_refund_id /
-- updated_at) is UNCHANGED. Only the new unconditional
-- workshop_reservations.updated_at bump is added.

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

  -- Bump refunded_amount once, only on the first transition into 'refunded'
  -- — UNCHANGED from the original logic (20260909120300_workshop_rpcs.sql).
  if p_refund_status = 'refunded' and v_log.refund_status <> 'refunded' then
    update public.workshop_reservations wr
    set refunded_amount = wr.refunded_amount + coalesce(p_refund_amount_completed, 0)
    where wr.id = v_log.reservation_id;
  end if;

  -- NEW: mark the reservation dirty for Make sync on EVERY call — a refund
  -- status/amount/reference change is always Notion-visible, not only the
  -- terminal 'refunded' transition. This is the only change this migration
  -- makes beyond the original, unchanged behaviour above.
  update public.workshop_reservations
  set updated_at = now()
  where id = v_log.reservation_id;

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

revoke all on function public.finalize_workshop_refund(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.finalize_workshop_refund(uuid, text, numeric, text) to service_role;
