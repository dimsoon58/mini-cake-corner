-- Payment resilience — Migration 1/3: public.payment_attempts
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only:
-- one brand-new table, no change to any existing table, function or policy.
--
-- Purpose: keep a durable trace of every checkout payment attempt, EVEN when
-- no real order is ever created (declined card, abandoned page, technical
-- error). One row per orderId (the frontend crypto.randomUUID()); a retry on
-- the SAME orderId updates that row in place, a retry with a NEW orderId is a
-- new row. NEVER stores any card / bank / PAN data — only our own ids,
-- amounts, a coarse status and error type, and webhook bookkeeping.
--
-- status:
--   'payment_page_created' — create-postfinance-payment produced a PostFinance
--                            transaction + payment-page URL for this orderId.
--   'payment_failed'       — the PostFinance transaction ended FAILED / DECLINE
--                            / VOIDED (normal decline included — NOT alerted).
--   'technical_error'      — a real backend/PostFinance-API failure prevented
--                            the payment from starting or resuming (alerted).
--   'completed'            — confirm-postfinance-payment finalised the order.

create table if not exists public.payment_attempts (
  order_id                  uuid primary key,
  postfinance_transaction_id text,
  status                    text not null,
  error_type                text,
  amount                    numeric(10,2),
  lang                      text,
  webhook_seen_at           timestamptz,
  last_webhook_event_id     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.payment_attempts is
  'Durable trace of every checkout payment attempt, including attempts that never became an order. No card/bank data. One row per frontend orderId.';

create index if not exists payment_attempts_txid_idx
  on public.payment_attempts (postfinance_transaction_id);

create index if not exists payment_attempts_status_idx
  on public.payment_attempts (status);

-- Service-role only. The Edge Functions use the service_role key (bypasses
-- RLS); no browser client ever reads or writes this table.
alter table public.payment_attempts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payment_attempts'
      and policyname = 'Service role only'
  ) then
    create policy "Service role only" on public.payment_attempts
      for all using (false) with check (false);
  end if;
end $$;
