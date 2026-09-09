-- Workshop architecture — Migration 3/4: extra workshop columns on order_items
--
-- NOT YET APPLIED — run manually on Supabase after review.
-- Additive only. Existing rows get the defaults; no cake column is touched or
-- overloaded. Nothing outside the Workshop perimeter changes.
--
--   workshop_reference               written back by confirm-postfinance-payment
--                                    once claim_workshop_reservation() succeeds,
--                                    so emails / invoice / admin can read it
--                                    straight off the order_item.
--   workshop_has_minor               from the Workshop form ("does the booking
--                                    include one or more participants under 18?")
--   workshop_minor_consent_confirmed mandatory checkbox when has_minor = true;
--                                    false whenever has_minor = false.

alter table public.order_items
  add column if not exists workshop_reference               text,
  add column if not exists workshop_has_minor               boolean not null default false,
  add column if not exists workshop_minor_consent_confirmed boolean not null default false;

comment on column public.order_items.workshop_reference is
  'Workshop line only: WS-XXXXXX booking reference, copied from workshop_reservations after claim. NULL for every other product.';
