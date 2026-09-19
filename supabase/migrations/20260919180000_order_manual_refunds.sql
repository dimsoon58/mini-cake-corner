-- Manual refund log — /admin/dashboard revenue exactness.
--
-- WHY THIS EXISTS: the existing refund tracking (orders.refund_status /
-- refund_due_amount, _shared/order-refunds.ts) only ever fires from ONE
-- specific, automated path — a Refuse decision on an order whose payment
-- was unexpectedly already captured (see manage-order's mark_refunded
-- action). Any OTHER refund the admin does by hand directly in PostFinance
-- (a goodwill gesture, a complaint, a partial adjustment — for ANY reason,
-- on an order in ANY state) was never recorded anywhere in Supabase at all
-- — automatic PostFinance→Supabase refund sync was deliberately removed
-- earlier (kept manual/untracked). That left /admin/dashboard's revenue
-- total unable to ever be exact for those cases.
--
-- This table is a simple, append-only, per-order LOG (not a single running
-- total column) — an order can be manually refunded more than once over its
-- life (e.g. a small goodwill amount now, another adjustment later), and a
-- log keeps the full history/audit trail instead of one field that could be
-- overwritten or fought over by concurrent admin actions. Sum the rows for
-- a given order to get its total manually-refunded amount.
--
-- Deliberately independent of orders.refund_status/refund_due_amount/
-- payment_status — recording a manual refund here never changes any of
-- those columns, and the existing mark_refunded/decide_order_physical flow
-- is completely untouched by this table.
--
-- Service-role only, same convention as payment_attempts/workshop_
-- cancellation_log — written exclusively by manage-order's new
-- "record_manual_refund" action (admin session + ADMIN_ORDER_PIN gated,
-- same as mark_refunded), never exposed to a browser client directly.
create table if not exists public.order_manual_refunds (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id),
  amount     numeric(10,2) not null check (amount > 0),
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table public.order_manual_refunds is
  'Append-only log of ad-hoc manual refunds an admin records by hand (any reason, any order state) — independent of orders.refund_status. Sum per order_id for that order''s total manually-refunded amount.';

create index if not exists order_manual_refunds_order_id_idx
  on public.order_manual_refunds (order_id);

create index if not exists order_manual_refunds_created_at_idx
  on public.order_manual_refunds (created_at);

alter table public.order_manual_refunds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_manual_refunds'
      and policyname = 'Service role only'
  ) then
    create policy "Service role only" on public.order_manual_refunds
      for all using (false) with check (false);
  end if;
end $$;
