-- Partner referral system — BASELINE (step 0 of the /admin/partners work).
--
-- Why: `public.partners` and the `partner_*` columns on orders/order_items
-- were created directly in Supabase (2026-09-16) and never had a migration
-- in this repo. This file records their exact live definition (verified by
-- the owner in the SQL editor on 2026-09-28) so the repo matches production
-- and later migrations build on a known schema.
--
-- Behaviour: on production EVERY statement below is a no-op — the table,
-- columns, constraints, index, RLS flag and grants already exist exactly as
-- written. Safe to run (or re-run) at any time; on a fresh database it
-- recreates the same schema. Nothing is renamed, altered or dropped.

-- ── partners ────────────────────────────────────────────────────────────
create table if not exists public.partners (
  id                     uuid        not null default gen_random_uuid(),
  name                   text        not null,
  slug                   text        not null,
  customer_discount_rate numeric     not null default 0.10,
  commission_rate        numeric     not null default 0.20,
  active                 boolean     not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Used in the public link (?ref=<referral_token>). resolve-partner-ref
  -- only accepts a UUID, so this must stay a uuid.
  referral_token         uuid        not null default gen_random_uuid(),
  constraint partners_pkey primary key (id),
  constraint partners_slug_key unique (slug),
  constraint partners_slug_format_check
    check ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)),
  constraint partners_customer_discount_rate_check
    check (((customer_discount_rate >= (0)::numeric) and (customer_discount_rate <= (1)::numeric))),
  constraint partners_commission_rate_check
    check (((commission_rate >= (0)::numeric) and (commission_rate <= (1)::numeric)))
);

-- Unique index on referral_token. Live, it is a unique INDEX (not a named
-- constraint) whose name was not recorded — so this checks for ANY
-- single-column unique index on referral_token rather than a name, to never
-- create a duplicate index on production.
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = 'public.partners'::regclass
      and i.indisunique
      and i.indnkeyatts = 1
      and a.attname = 'referral_token'
  ) then
    create unique index partners_referral_token_key on public.partners (referral_token);
  end if;
end $$;

-- Live: RLS enabled, no policy, table granted only to postgres/service_role.
-- anon/authenticated have no access at all — every read goes through Edge
-- Functions using the service role (resolve-partner-ref,
-- create-postfinance-payment).
alter table public.partners enable row level security;
revoke all on public.partners from anon, authenticated;

-- ── orders: partner snapshot, written by create-postfinance-payment ──────
alter table public.orders
  add column if not exists partner_id uuid
    constraint orders_partner_id_fkey references public.partners(id) on delete set null,
  add column if not exists partner_name text,
  add column if not exists partner_slug text,
  add column if not exists partner_discount_rate numeric
    constraint orders_partner_discount_rate_check
    check (((partner_discount_rate is null) or ((partner_discount_rate >= (0)::numeric) and (partner_discount_rate <= (1)::numeric)))),
  add column if not exists partner_discount_base numeric not null default 0,
  add column if not exists partner_discount_amount numeric not null default 0,
  add column if not exists partner_commission_rate numeric
    constraint orders_partner_commission_rate_check
    check (((partner_commission_rate is null) or ((partner_commission_rate >= (0)::numeric) and (partner_commission_rate <= (1)::numeric)))),
  add column if not exists partner_commission_base numeric not null default 0,
  add column if not exists partner_commission_amount numeric not null default 0,
  add column if not exists partner_commission_status text not null default 'none'
    constraint orders_partner_commission_status_check
    check ((partner_commission_status = any (array['none'::text, 'pending'::text, 'paid'::text, 'cancelled'::text]))),
  add column if not exists partner_commission_paid_at timestamptz;

-- ── order_items: per-line partner snapshot ───────────────────────────────
alter table public.order_items
  add column if not exists partner_discount_base numeric not null default 0,
  add column if not exists partner_discount_amount numeric not null default 0,
  add column if not exists partner_commission_base numeric not null default 0,
  add column if not exists partner_commission_amount numeric not null default 0;
