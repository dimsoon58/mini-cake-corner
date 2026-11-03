-- F37 (03.11.2026) — Bons cadeaux, step 1: buying a voucher online.
-- A voucher is a CHF amount usable on the whole site (step 2: in the cart's
-- « Code promo » field, as a means of payment), valid 12 months from
-- payment. It lives apart from orders: no production, labels or « Aujourd'hui ».
-- Only the Edge Functions (service role) read and write this table.
--
-- Lifecycle (status):
--   pending  — row created, PostFinance payment page opened, not paid yet
--   active   — paid (captured immediately): code assigned, balance = amount
--   failed   — the payment failed / was declined / voided (no code)
--   disabled — deactivated by an administrator (step 3)
begin;

create table if not exists public.gift_cards (
  id                         uuid primary key default gen_random_uuid(),
  code                       text unique check (code is null or code ~ '^BCS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  initial_amount             numeric(10,2) not null check (initial_amount > 0 and initial_amount <= 2000),
  balance                    numeric(10,2) not null default 0 check (balance >= 0 and balance <= initial_amount),
  status                     text not null default 'pending' check (status in ('pending', 'active', 'failed', 'disabled')),
  source                     text not null default 'online' check (source in ('online', 'manual')),
  buyer_name                 text not null check (length(buyer_name) between 1 and 120),
  buyer_email                text not null check (length(buyer_email) between 3 and 254),
  recipient_name             text check (recipient_name is null or length(recipient_name) <= 80),
  message                    text check (message is null or length(message) <= 200),
  lang                       text not null default 'fr' check (lang in ('fr', 'en')),
  postfinance_transaction_id text unique,
  paid_at                    timestamptz,
  expires_at                 timestamptz,
  email_status               text not null default 'pending' check (email_status in ('pending', 'sending', 'sent', 'error')),
  email_attempts             integer not null default 0,
  email_claimed_at           timestamptz,
  email_sent_at              timestamptz,
  email_error                text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint gift_cards_active_has_code check (status <> 'active' or (code is not null and paid_at is not null and expires_at is not null))
);

create index if not exists gift_cards_status_idx on public.gift_cards (status, created_at desc);
create index if not exists gift_cards_buyer_email_idx on public.gift_cards (lower(buyer_email));

alter table public.gift_cards enable row level security;
-- No policy on purpose: only the service role (Edge Functions) gets through.
revoke all on table public.gift_cards from public, anon, authenticated;
grant all on table public.gift_cards to service_role;

comment on table public.gift_cards is
  'F37 — gift vouchers (CHF amount, whole site, 12 months). Bought online through create-gift-card-payment (immediate capture), activated by confirm-gift-card-payment / postfinance-webhook. Never exposed to anon.';

commit;

-- Checks (expected: 0 | 0 policies | t):
-- select count(*) from public.gift_cards;
-- select count(*) from pg_policies where schemaname = 'public' and tablename = 'gift_cards';
-- select relrowsecurity from pg_class where oid = 'public.gift_cards'::regclass;
--
-- ROLLBACK (only before any real voucher exists):
-- drop table if exists public.gift_cards;
