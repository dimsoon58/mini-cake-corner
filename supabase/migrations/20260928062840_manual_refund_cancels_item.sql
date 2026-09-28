-- M3 — order_manual_refunds.cancels_item: tells a goodwill refund apart from
-- a cake that was actually cancelled.
--
-- Why: partner commission rules (decided 2026-09-28):
--   - a partial refund that is only a goodwill gesture leaves the partner's
--     commission unchanged;
--   - a refund that really cancels an eligible item removes that item's
--     commission base.
-- Nothing in the database distinguishes the two today — a manual refund is
-- just an amount (optionally tied to one order_item). This flag is set by
-- the admin in the manual refund form ("this refund cancels this cake"),
-- and only makes sense for a refund tied to one item.
--
-- Existing rows: all get FALSE (= goodwill gesture, commission unchanged).
-- No historical row is otherwise modified. The main dashboard does not read
-- this column — its refund totals are unchanged.
--
-- Additive only, re-runnable.

alter table public.order_manual_refunds
  add column if not exists cancels_item boolean not null default false;

comment on column public.order_manual_refunds.cancels_item is
  'TRUE when this refund cancels the item it is tied to (order_item_id): the item''s partner commission base is then removed. FALSE (default) = goodwill gesture, partner commission unchanged. Does not affect refund totals.';

-- A refund can only "cancel an item" if it is tied to one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_manual_refunds'::regclass
      and conname = 'order_manual_refunds_cancels_item_needs_item_check'
  ) then
    alter table public.order_manual_refunds
      add constraint order_manual_refunds_cancels_item_needs_item_check
      check (not cancels_item or order_item_id is not null);
  end if;
end $$;
