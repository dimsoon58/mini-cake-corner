-- Payment resilience — Migration 3/6: finalisation lease + side-effect RPCs
--
-- PARTIALLY APPLIED — the finalisation RPCs already exist in production with
-- an OLDER definition. This file is CREATE OR REPLACE for all four; it MUST be
-- re-run to pick up the current logic (finalization_claimed_at as the lease,
-- side_effects_done_at guard on claim_side_effect_retry, etc.). Run AFTER
-- 20260909140100 (needs the new orders columns). Fully re-runnable.
--
-- claim_order_finalization(p_order_id) — atomic LEASE. Returns TRUE to exactly
--   one caller, which then inserts order_items and calls mark_order_finalized().
--   The single UPDATE ... WHERE finalized_at IS NULL AND (lease free/stale) is
--   the serialization point (Postgres row-locks the orders row). A lease held
--   for > 3 minutes without the order becoming finalised is treated as a
--   crashed finaliser and may be taken over.
--
-- mark_order_finalized(p_order_id) — set finalized_at, ONLY after every
--   order_items row exists. This is what makes finalized_at mean "DB complete".
--
-- release_order_finalization(p_order_id) — drop the lease when the winner
--   failed before writing any order_items. Never touches finalized_at, no-op
--   once order_items exist.
--
-- claim_side_effect_retry(p_order_id) — a 45-second lease so that a poll and
--   the webhook (or several polls) don't all re-fire the Make webhook / the
--   e-mails at the same time. Only ever relevant once finalized_at is set.

create or replace function public.claim_order_finalization(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.orders o
     set finalization_claimed_at = now()
   where o.id = p_order_id
     and o.finalized_at is null
     and (
       o.finalization_claimed_at is null
       or o.finalization_claimed_at < now() - interval '3 minutes'
     )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.claim_order_finalization(uuid) is
  'Atomic finalisation lease for confirm-postfinance-payment. TRUE to exactly one concurrent caller; a lease older than 3 minutes without finalized_at is recoverable.';

create or replace function public.mark_order_finalized(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set finalized_at = now()
   where id = p_order_id
     and finalized_at is null;
end;
$$;

comment on function public.mark_order_finalized(uuid) is
  'Set orders.finalized_at — call ONLY after every order_items row has been inserted.';

create or replace function public.release_order_finalization(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders o
     set finalization_claimed_at = null
   where o.id = p_order_id
     and o.finalized_at is null
     and not exists (
       select 1 from public.order_items oi where oi.order_id = o.id
     );
end;
$$;

comment on function public.release_order_finalization(uuid) is
  'Drop the finalisation lease when the winner failed before writing any order_items. No-op once order_items exist; never touches finalized_at.';

create or replace function public.claim_side_effect_retry(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.orders o
     set side_effects_retry_at = now()
   where o.id = p_order_id
     and o.finalized_at is not null
     and o.side_effects_done_at is null
     and (
       o.side_effects_retry_at is null
       or o.side_effects_retry_at < now() - interval '45 seconds'
     )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.claim_side_effect_retry(uuid) is
  '45s lease so concurrent poll/webhook callers do not all re-fire the Make webhook and the e-mails at once. Only relevant once finalized_at is set.';

revoke all on function public.claim_order_finalization(uuid)  from public, anon, authenticated;
revoke all on function public.mark_order_finalized(uuid)       from public, anon, authenticated;
revoke all on function public.release_order_finalization(uuid) from public, anon, authenticated;
revoke all on function public.claim_side_effect_retry(uuid)    from public, anon, authenticated;
grant execute on function public.claim_order_finalization(uuid)  to service_role;
grant execute on function public.mark_order_finalized(uuid)       to service_role;
grant execute on function public.release_order_finalization(uuid) to service_role;
grant execute on function public.claim_side_effect_retry(uuid)    to service_role;
