-- S1 — Minimal privileges for anon / authenticated.
--
-- APPLIED IN PRODUCTION on 2026-09-30 (version 20260930121354). This file is
-- the repo copy of what was applied; it is NOT to be pushed again
-- (never run `supabase db push`: the live migration history does not match
-- the repo filenames).
--
-- Before S1 (read-only snapshot of 2026-09-30, PostgreSQL 17):
--   * anon AND authenticated held all 8 table privileges (SELECT, INSERT,
--     UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on the 10
--     tables below = 160 grants. RLS already blocked every row (verified:
--     anon reads returned 0 rows), but the grants were one mistake away from
--     exposing orders, profiles and rewards.
--   * no column-level grants, no WITH GRANT OPTION.
--   * PUBLIC / anon / authenticated could EXECUTE the 3 functions below
--     (reconcile_reward_after_physical_refunds is SECURITY DEFINER).
--   * bucket order-images: public, no size limit, no MIME restriction.
--
-- After S1 (verified right after applying): 4 / 3 / 0 —
--   authenticated SELECT on orders, order_items, profiles,
--   reward_transactions; authenticated UPDATE on profiles.phone,
--   profiles.birth_date, profiles.newsletter_subscription; nothing for anon;
--   no EXECUTE for PUBLIC / anon / authenticated on the 3 functions.
--
-- The site only uses, directly: logged-in reads of its own profile / orders /
-- items / fulfillments / reward transactions (RLS-limited), the 3 profile
-- fields above (Account page, newsletter at checkout) and image uploads at
-- checkout. Everything else goes through Edge Functions with service_role,
-- which S1 does not touch. RLS policies, triggers, service_role and postgres
-- are unchanged. order_fulfillments was already SELECT-only: unchanged.
begin;

-- Safety net: refuse to apply if RLS is off on any of the 10 tables.
do $$
declare v_missing text;
begin
  select string_agg(relname, ', ') into v_missing
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('orders','order_items','profiles','pending_payments',
                    'reward_transactions','reward_reservations','reward_reservation_items',
                    'order_manual_refunds','order_number_counters','payment_reference_counters')
    and not relrowsecurity;
  if v_missing is not null then
    raise exception 'S1 annulé : RLS désactivé sur %', v_missing;
  end if;
end $$;

-- 1. Remove every direct privilege (all 8, MAINTAIN included) from anon and authenticated.
revoke all on table
  public.orders, public.order_items, public.profiles, public.pending_payments,
  public.reward_transactions, public.reward_reservations, public.reward_reservation_items,
  public.order_manual_refunds, public.order_number_counters, public.payment_reference_counters
from anon, authenticated;

-- 2. Logged-in customers: only what the site uses (RLS already limits them to their own rows).
grant select on table public.orders, public.order_items, public.reward_transactions, public.profiles
  to authenticated;
grant update (phone, birth_date, newsletter_subscription) on table public.profiles
  to authenticated;

-- 3. Server-only functions. service_role and postgres keep their existing access.
revoke execute on function public.reconcile_reward_after_physical_refunds(uuid)
  from public, anon, authenticated;
revoke execute on function public.accounting_monthly_summary()
  from public, anon, authenticated;
revoke execute on function public.sync_manual_accounting_refund_event(uuid, numeric, numeric, uuid, text, timestamptz)
  from public, anon, authenticated;

-- 4. Reference photos: images only, 15 MB max. The bucket stays public.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
    file_size_limit    = 15728640
where id = 'order-images';

commit;

-- ROLLBACK (exact restore of the 2026-09-30 snapshot — run only if needed):
--
-- begin;
-- revoke all on table
--   public.orders, public.order_items, public.profiles, public.pending_payments,
--   public.reward_transactions, public.reward_reservations, public.reward_reservation_items,
--   public.order_manual_refunds, public.order_number_counters, public.payment_reference_counters
-- from anon, authenticated;
-- grant select, insert, update, delete, truncate, references, trigger, maintain on table
--   public.orders, public.order_items, public.profiles, public.pending_payments,
--   public.reward_transactions, public.reward_reservations, public.reward_reservation_items,
--   public.order_manual_refunds, public.order_number_counters, public.payment_reference_counters
-- to anon, authenticated;
-- grant execute on function public.reconcile_reward_after_physical_refunds(uuid)
--   to public, anon, authenticated;
-- grant execute on function public.accounting_monthly_summary()
--   to public, anon, authenticated;
-- grant execute on function public.sync_manual_accounting_refund_event(uuid, numeric, numeric, uuid, text, timestamptz)
--   to public, anon, authenticated;
-- update storage.buckets set allowed_mime_types = null, file_size_limit = null
-- where id = 'order-images';
-- commit;
