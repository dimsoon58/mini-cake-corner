-- Reward trigger — physical-validation aware
--
-- NOT YET APPLIED. Run AFTER 20260911120000_mixed_orders_immediate_capture.sql.
--
-- Verified LIVE state (2026-09-11):
--   trigger  trg_order_reward_status_change  AFTER UPDATE OF order_validation, payment_status
--   function handle_order_reward_status_change():
--     * transition payment_status -> 'refunded'                       -> refund_reward_for_order(id)
--     * transition order_validation -> 'approved' with payment_status='paid' -> finalize_reward_for_order(id)
--     * transition order_validation -> 'rejected'                     -> release_reward_reservation(id)
--
-- This migration REPLACES that function and RECREATES the trigger to ALSO
-- listen to physical_validation. The three live branches are kept in the SAME
-- order (refunded -> finalize -> rejected); one branch is PREPENDED:
--
--   0. transition physical_validation -> 'rejected'  -> release_reward_reservation
--      A mixed order whose cake part is refused keeps order_validation='approved'
--      (the workshop stays honoured). The reward reserved on the refused cake
--      part must be RELEASED, never finalised — so this is checked FIRST.
--   1. transition payment_status -> 'refunded'       -> refund_reward_for_order
--   2. order_validation='approved' + payment_status='paid' just reached, AND the
--      physical part is NOT rejected                 -> finalize_reward_for_order
--   3. transition order_validation -> 'rejected'     -> release_reward_reservation
--
-- GUARANTEE — a mixed reject (order_validation='approved' + physical_validation
-- ='rejected') can NEVER reach finalize_reward_for_order:
--   (a) branch 0 (physical rejected) is checked FIRST in the IF/ELSIF chain;
--   (b) branch 2 has an explicit  physical_validation <> 'rejected'  guard;
--   (c) the OLD/NEW transition guard on branch 2 means it only fires on a real
--       transition INTO (approved, paid) — which for a mixed order is the
--       ACCEPT, never the refuse; a later re-UPDATE where physical_validation is
--       already 'rejected' matches neither branch 0 (no transition) nor 2 (guard).
--
-- All RPCs already exist in production: finalize_reward_for_order(uuid),
-- release_reward_reservation(uuid), refund_reward_for_order(uuid).

create or replace function public.handle_order_reward_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 0. Physical part just refused (checked first — a mixed reject must land here,
  --    never in the finalize branch).
  if new.physical_validation = 'rejected'
     and old.physical_validation is distinct from 'rejected' then
    perform public.release_reward_reservation(new.id);

  -- 1. Payment refunded (LIVE branch 1). Cake-only full manual refund; never a
  --    mixed order, where manage-order keeps payment_status = 'paid'.
  elsif new.payment_status = 'refunded'
     and old.payment_status is distinct from 'refunded' then
    perform public.refund_reward_for_order(new.id);

  -- 2. Physical part fulfilled + paid, just reached that state (LIVE branch 2).
  elsif new.order_validation = 'approved'
     and new.payment_status = 'paid'
     and coalesce(new.physical_validation, 'not_applicable') <> 'rejected'
     and (old.order_validation is distinct from 'approved'
       or old.payment_status  is distinct from 'paid') then
    perform public.finalize_reward_for_order(new.id);

  -- 3. Whole order refused, cake-only path (LIVE branch 3).
  elsif new.order_validation = 'rejected'
     and old.order_validation is distinct from 'rejected' then
    perform public.release_reward_reservation(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_reward_status_change on public.orders;
create trigger trg_order_reward_status_change
  after update of order_validation, payment_status, physical_validation
  on public.orders
  for each row
  execute function public.handle_order_reward_status_change();
