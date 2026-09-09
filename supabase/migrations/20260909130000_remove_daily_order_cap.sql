-- Physical-product order calendar: remove the per-day order cap.
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive/idempotent
-- (CREATE OR REPLACE only). Nothing outside the order-calendar rule changes:
-- no touch to workshops, workshop_sessions, workshop_reservations, pricing,
-- PostFinance, welcome discount, reward, Make/Notion, emails.
--
-- Until now:
--   get_order_count_for_date(target_date)  -> COUNT(orders) for that day
--   get_fully_booked_dates()               -> days with >= 5 approved orders
-- and the frontend disabled any date returned by get_fully_booked_dates() and
-- rejected a checkout once get_order_count_for_date() >= 5.
--
-- New rule: orders are UNLIMITED per date. Both functions are redefined as
-- no-ops so any remaining caller (frontend, other code) keeps working but can
-- never block a date again. The only remaining calendar rule is the J+2 lead
-- time, enforced in the UI and by the server via pickup_delivery_date.

create or replace function public.get_order_count_for_date(target_date date)
returns integer
language sql
immutable
security definer
set search_path to 'public'
as $$
  -- No per-day cap any more. Always 0.
  select 0::integer;
$$;

create or replace function public.get_fully_booked_dates()
returns table(booked_date date)
language sql
immutable
security definer
set search_path to 'public'
as $$
  -- No per-day cap any more. Never any fully-booked date.
  select null::date where false;
$$;
