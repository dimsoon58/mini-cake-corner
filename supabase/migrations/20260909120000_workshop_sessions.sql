-- Workshop architecture — Migration 1/4: workshop_sessions (session catalogue)
--
-- NOT YET APPLIED — run manually on Supabase after review.
-- Additive only. Touches nothing outside the Workshop perimeter: no change to
-- orders, order_items (see migration 3/4), products, pricing, PostFinance,
-- welcome discount, reward, Make/Notion triggers.
--
-- Server-authoritative source of truth for a workshop session: price,
-- capacity, date, time, open/closed. Session ids are EXACTLY the ids the live
-- create-postfinance-payment / _shared/workshops.ts already validate against:
--   sig-2026-10-03 / paint-2026-10-07 / paint-2026-10-10 / paint-2026-10-14
-- They are not renamed.

create table if not exists public.workshop_sessions (
  id            text        primary key,
  workshop_type text        not null check (workshop_type in ('signature', 'paint')),
  workshop_date date        not null,
  workshop_time text        not null,
  unit_price    numeric(10,2) not null check (unit_price > 0),
  max_capacity  integer     not null check (max_capacity > 0),
  is_open       boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.workshop_sessions is
  'Bookable workshop sessions. Server-authoritative for price, capacity, date, time, is_open. Ids match the live create-postfinance-payment session ids.';

-- Exactly the 4 sessions currently on offer, with the live ids.
insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values
  ('sig-2026-10-03',   'signature', date '2026-10-03', '13:00', 85, 8),
  ('paint-2026-10-07', 'paint',     date '2026-10-07', '14:00', 65, 10),
  ('paint-2026-10-10', 'paint',     date '2026-10-10', '14:00', 65, 10),
  ('paint-2026-10-14', 'paint',     date '2026-10-14', '14:00', 65, 10)
on conflict (id) do nothing;

alter table public.workshop_sessions enable row level security;

-- The session catalogue (price / capacity / date / time / is_open) is public
-- read-only. Live remaining-seat counts go through get_workshop_availability()
-- (migration 4/4), not through this table directly.
drop policy if exists "workshop_sessions_public_read" on public.workshop_sessions;
create policy "workshop_sessions_public_read"
  on public.workshop_sessions
  for select
  using (true);
