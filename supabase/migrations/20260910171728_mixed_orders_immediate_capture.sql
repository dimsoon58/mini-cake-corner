-- Mixed carts (workshop + physical) + immediate capture
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only.
-- Run AFTER 20260910120000_workshop_auto_confirm.sql.
--
-- New model (source of truth):
--   * EVERY payment is captured immediately at checkout
--     (create-postfinance-payment: completionBehavior = COMPLETE_IMMEDIATELY).
--     payment_status = 'paid' therefore means "the money was really taken".
--   * manage-order NEVER moves money any more (no capture / void / refund).
--   * A cake / physical order: paid immediately, order_validation = 'pending',
--     admin Accept/Refuse decides ONLY fulfilment. Refuse => the money stays
--     captured and the order is flagged refund_status = 'to_refund' with the
--     exact amount; the refund is done BY HAND in PostFinance for now.
--   * A public workshop-only order: auto-confirmed after real payment
--     confirmation (unchanged, 20260910120000 — minus the capture, which now
--     happens at checkout).
--   * A MIXED order (>=1 workshop line AND >=1 physical line): one checkout,
--     one immediate capture. The workshop part auto-confirms; the physical
--     part stays 'pending' for the admin. Refuse physical => partial refund
--     amount = total_amount - sum(workshop line totals), done by hand; the
--     workshop stays paid / confirmed / reserved and is NEVER cancelled.
--
--   orders.fulfillment_type      'cake_only' | 'workshop_only' | 'mixed'
--                                (derived from order_items at finalisation).
--   orders.physical_validation   'pending' | 'approved' | 'rejected' for any
--                                order WITH a physical part (cake_only, mixed);
--                                'not_applicable' ONLY for a workshop-only order.
--                                The ONLY thing the admin decides.
--   orders.physical_decided_at   when the admin decided the physical part.
--   orders.refund_status         'none' | 'to_refund' | 'refunded'.
--                                'to_refund' set on a physical refusal; an admin
--                                marks it 'refunded' once the manual PostFinance
--                                refund is really done.
--   orders.refund_due_amount     exact CHF amount to refund by hand (server
--                                computed: total_amount for a cake_only refusal,
--                                total_amount - workshop_subtotal for a mixed
--                                refusal). 0 otherwise.
--   orders.refund_marked_at      when an admin marked the manual refund done.
--   orders.refund_reference      PostFinance refund id / note entered by hand.

alter table public.orders
  add column if not exists fulfillment_type    text,
  -- Default 'pending': a physical order created by any path (checkout, manual)
  -- is awaiting a decision. A workshop-only order is explicitly set to
  -- 'not_applicable' by confirm-postfinance-payment / runSideEffects.
  add column if not exists physical_validation text        not null default 'pending',
  add column if not exists physical_decided_at timestamptz,
  add column if not exists refund_status       text        not null default 'none',
  add column if not exists refund_due_amount   numeric(10,2) not null default 0,
  add column if not exists refund_marked_at    timestamptz,
  add column if not exists refund_reference    text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_fulfillment_type_check'
  ) then
    alter table public.orders
      add constraint orders_fulfillment_type_check
      check (fulfillment_type is null or fulfillment_type in ('cake_only', 'workshop_only', 'mixed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_physical_validation_check'
  ) then
    alter table public.orders
      add constraint orders_physical_validation_check
      check (physical_validation in ('not_applicable', 'pending', 'approved', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_refund_status_check'
  ) then
    alter table public.orders
      add constraint orders_refund_status_check
      check (refund_status in ('none', 'to_refund', 'refunded'));
  end if;
end $$;

comment on column public.orders.fulfillment_type   is 'cake_only | workshop_only | mixed — derived from order_items at finalisation.';
comment on column public.orders.physical_validation is 'not_applicable | pending | approved | rejected — the physical-items admin decision. not_applicable for a workshop-only order.';
comment on column public.orders.physical_decided_at is 'When the admin approved/rejected the physical part.';
comment on column public.orders.refund_status      is 'none | to_refund | refunded — manual PostFinance refund tracking (no automatic refund in the new model).';
comment on column public.orders.refund_due_amount  is 'Exact CHF amount to refund BY HAND. Server-computed. 0 when nothing is owed.';
comment on column public.orders.refund_marked_at   is 'When an admin marked the manual refund as done.';
comment on column public.orders.refund_reference   is 'PostFinance refund id / free note captured when the manual refund was done.';

-- Fast admin lookup: orders whose money still has to be refunded by hand.
create index if not exists orders_refund_to_do_idx
  on public.orders (physical_decided_at)
  where refund_status = 'to_refund';

-- ── Backfill ────────────────────────────────────────────────────────────
-- fulfillment_type for every existing order.
update public.orders o
set fulfillment_type = case
  when     exists (select 1 from public.order_items i where i.order_id = o.id and i.product =  'workshop')
       and exists (select 1 from public.order_items i where i.order_id = o.id and i.product <> 'workshop')
    then 'mixed'
  when exists (select 1 from public.order_items i where i.order_id = o.id and i.product = 'workshop')
    then 'workshop_only'
  else 'cake_only'
end
where o.fulfillment_type is null;

-- physical_validation derived from the historical order_validation:
--   workshop-only        -> 'not_applicable'
--   approved             -> 'approved'
--   rejected / cancelled -> 'rejected'
--   else (pending)       -> 'pending'
update public.orders o
set physical_validation = case
  when o.fulfillment_type = 'workshop_only'              then 'not_applicable'
  when o.order_validation = 'approved'                   then 'approved'
  when o.order_validation in ('rejected', 'cancelled')  then 'rejected'
  else 'pending'
end
where o.fulfillment_type is not null;
