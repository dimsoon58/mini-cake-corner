-- F36 (03.11.2026) — « Notes internes » on every order (manual and website).
-- Dated comments written by the team (Mel, Eli, Nahya), each with optional
-- photos (e.g. a screenshot of a customer's WhatsApp message). Never shown to
-- the customer: no email, invoice or customer page reads this table.
-- Only the Edge Function manage-order-notes (service role) reads and writes:
-- no anon / authenticated access to the table or the bucket.
-- Photos live in a PRIVATE bucket (order-notes) and are shown through
-- short-lived signed URLs — unlike order-images, which is public.
begin;

create table if not exists public.order_internal_notes (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  body         text check (body is null or length(body) <= 4000),
  image_paths  text[] not null default '{}' check (cardinality(image_paths) <= 10),
  author_email text not null,
  author_name  text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text,
  constraint order_internal_notes_not_empty check (nullif(btrim(coalesce(body, '')), '') is not null or cardinality(image_paths) > 0)
);

create index if not exists order_internal_notes_order_idx
  on public.order_internal_notes (order_id, created_at)
  where deleted_at is null;

alter table public.order_internal_notes enable row level security;
-- No policy on purpose: only the service role (Edge Function) gets through.
revoke all on table public.order_internal_notes from public, anon, authenticated;
grant all on table public.order_internal_notes to service_role;

comment on table public.order_internal_notes is
  'F36 — internal team notes on an order (text + photos in the private order-notes bucket). Never shown to the customer. Written only by manage-order-notes.';

-- Private bucket: images only, 15 MB max (same limits as order-images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-notes', 'order-notes', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;

-- Checks (expected: 0 | false | 0 policies on the table):
-- select count(*) from public.order_internal_notes;
-- select public from storage.buckets where id = 'order-notes';
-- select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_internal_notes';
--
-- ROLLBACK (only if needed, before any real note exists):
-- begin;
-- drop table if exists public.order_internal_notes;
-- delete from storage.buckets where id = 'order-notes';  -- only works while the bucket is empty
-- commit;
