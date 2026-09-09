-- Payment resilience — Migration 3/3: finalisation claim RPCs
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER migration
-- 20260909140100 (needs orders.finalized_at). CREATE OR REPLACE only.
--
-- claim_order_finalization(p_order_id) — atomic gate. Returns TRUE to exactly
-- one caller, which then runs insertOrderItemsAndFinalize() in the Edge
-- Function; every concurrent/later caller gets FALSE and just reports the
-- order as already-confirmed. The single UPDATE ... WHERE finalized_at IS NULL
-- is the serialization point: Postgres row-locks the orders row, so of two
-- strictly-concurrent callers the first sets finalized_at and the second
-- re-evaluates the WHERE against the new row and matches 0 rows.
--
-- Self-heal: if a claimer set finalized_at but then crashed before inserting
-- ANY order_items, a retry more than 3 minutes later is allowed to take over.
-- The 3-minute floor makes a double-claim by two concurrent callers
-- impossible (the second runs seconds, not minutes, after the first).

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
     set finalized_at = now()
   where o.id = p_order_id
     and (
       o.finalized_at is null
       or (
         o.finalized_at < now() - interval '3 minutes'
         and not exists (
           select 1 from public.order_items oi where oi.order_id = o.id
         )
       )
     )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.claim_order_finalization(uuid) is
  'Atomic finalisation gate for confirm-postfinance-payment. TRUE to exactly one concurrent caller (poll vs PostFinance webhook); that caller runs insertOrderItemsAndFinalize. Self-heals a crashed claim after 3 minutes if no order_items exist.';

-- Release the claim when the winning caller failed BEFORE inserting any
-- order_items (e.g. a transient error building the rows). Guarded so it can
-- never un-finalise an order that already has items. A WorkshopCapacityAbort
-- is NOT released this way — it persists its own order_failure_reason state.
create or replace function public.release_order_finalization(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders o
     set finalized_at = null
   where o.id = p_order_id
     and not exists (
       select 1 from public.order_items oi where oi.order_id = o.id
     );
end;
$$;

comment on function public.release_order_finalization(uuid) is
  'Undo a finalisation claim when the winner failed before writing any order_items. No-op once order_items exist.';

revoke all on function public.claim_order_finalization(uuid) from public, anon, authenticated;
revoke all on function public.release_order_finalization(uuid) from public, anon, authenticated;
grant execute on function public.claim_order_finalization(uuid) to service_role;
grant execute on function public.release_order_finalization(uuid) to service_role;
