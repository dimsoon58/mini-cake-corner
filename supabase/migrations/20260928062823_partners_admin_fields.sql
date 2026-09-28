-- M1 — partners: contact & administrative fields for the /admin/partners
-- section (partner list, partner profile, create/edit form).
--
-- Additive only: new NULLABLE columns, no default that rewrites existing
-- rows, no change to any existing column, constraint, index or grant. The 2
-- existing partners simply get NULL in every new field until edited from
-- the Admin. Nothing reads these columns yet — resolve-partner-ref and
-- create-postfinance-payment select their columns explicitly, so they are
-- unaffected.
--
-- No constraint change for customer_discount_rate = 0: the live check
-- (partners_customer_discount_rate_check) already allows 0 — only the Edge
-- Function code rejects it today, fixed in a later step.
--
-- Re-runnable: `add column if not exists` skips a column (and its inline
-- constraint) that already exists.

alter table public.partners
  add column if not exists establishment_type text
    constraint partners_establishment_type_check
    check (establishment_type is null or establishment_type in ('hotel', 'bar', 'restaurant', 'company', 'other')),
  add column if not exists address            text,
  add column if not exists website            text,
  add column if not exists contact_first_name text,
  add column if not exists contact_last_name  text,
  add column if not exists contact_email      text,
  add column if not exists contact_phone      text,
  add column if not exists start_date         date,
  add column if not exists notes              text;

comment on column public.partners.establishment_type is
  'Type of establishment: hotel / bar / restaurant / company / other. Optional.';
comment on column public.partners.start_date is
  'Date the partnership started (business date, set by the admin) — distinct from created_at, the row creation time.';
comment on column public.partners.notes is
  'Internal notes, admin-only. Never returned by resolve-partner-ref.';
