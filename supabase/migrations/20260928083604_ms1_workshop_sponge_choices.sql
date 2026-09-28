-- MS1 — order_items.workshop_sponge_choices: the sponge chosen by each
-- workshop participant ('vanilla' / 'chocolate'), in participant order.
-- The booking page already asks for it and the checkout already sends it,
-- but no column existed, so it was dropped. NULL for every existing row
-- (never backfilled or guessed) and for every non-workshop item.
-- Additive only.

alter table public.order_items
  add column if not exists workshop_sponge_choices text[]
    constraint order_items_workshop_sponge_choices_check
    check (
      workshop_sponge_choices is null
      or workshop_sponge_choices <@ array['vanilla', 'chocolate']::text[]
    );

comment on column public.order_items.workshop_sponge_choices is
  'Workshop only: sponge chosen by each participant (vanilla/chocolate), one entry per purchased seat. NULL when unknown (orders placed before 2026-09-28).';
