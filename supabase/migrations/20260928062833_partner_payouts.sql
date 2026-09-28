-- M2 — partner_payouts: history of commission payments made to partners.
--
-- Why a dedicated table: orders.partner_commission_status /
-- partner_commission_paid_at hold ONE status per ORDER, with no amount, note
-- or period. A partner is paid several times over several months, sometimes
-- partially, for many orders at once — recording that there would mean
-- rewriting historical orders on every payment. Those two columns are left
-- exactly as they are (create-postfinance-payment keeps writing
-- 'pending'/'none'); they are simply not used for payout tracking.
--
-- One row = one payment actually made. "Already paid" for a partner = SUM of
-- its rows; nothing is allocated to individual orders. The period is one
-- calendar month (period_start = 1st, period_end = last day), chosen in the
-- Admin form. Rows are written only by the manage-partner Edge Function
-- (service role, admin session + ADMIN_ORDER_PIN); deletion is only offered
-- to correct a typo.
--
-- Additive only: a new table, nothing existing is touched. Re-runnable.

create table if not exists public.partner_payouts (
  id           uuid          primary key default gen_random_uuid(),
  -- RESTRICT: a partner with recorded payouts can never be deleted (the
  -- Admin only ever deactivates partners anyway — deleting one would also
  -- detach its orders, orders.partner_id being ON DELETE SET NULL).
  partner_id   uuid          not null references public.partners(id) on delete restrict,
  amount       numeric(10,2) not null check (amount > 0),
  paid_on      date          not null,
  period_start date          not null,
  period_end   date          not null,
  note         text,
  created_by   text,
  created_at   timestamptz   not null default now(),
  constraint partner_payouts_period_check check (period_end >= period_start)
);

comment on table public.partner_payouts is
  'Commission payments made to partners (one row per payment). Already paid for a partner = SUM(amount). Written only via the manage-partner Edge Function.';
comment on column public.partner_payouts.paid_on is
  'Date the payment was actually made.';
comment on column public.partner_payouts.period_start is
  'First day of the period this payment covers (a calendar month).';
comment on column public.partner_payouts.period_end is
  'Last day of the period this payment covers.';

create index if not exists partner_payouts_partner_id_idx
  on public.partner_payouts (partner_id, period_start);

-- Same protection as public.partners and public.order_manual_refunds: RLS on,
-- a deny-all policy, and no grant to the public roles — only the service role
-- (Edge Functions) can read or write. Supabase grants new public-schema
-- tables to anon/authenticated by default, hence the explicit revoke.
alter table public.partner_payouts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'partner_payouts'
      and policyname = 'Service role only'
  ) then
    create policy "Service role only" on public.partner_payouts
      for all using (false) with check (false);
  end if;
end $$;

revoke all on public.partner_payouts from anon, authenticated;
