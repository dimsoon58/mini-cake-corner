-- Gender Reveal: the colour inside the cake ("Rose" / "Bleu") was captured
-- in the checkout UI (Catalog.tsx's selections.genderColor) but only ever
-- folded into decorationColorName, a browser-only display string that is
-- NEVER sent to the server (order_items.decoration_color is built from
-- selections.decorationColors alone — the gender colour was never added to
-- it). Result: the information never reached order_items, so it could
-- never reach Make/Notion either, however "couleur de décoration" is
-- mapped there today.
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo.
--
-- Deliberately a separate column from decoration_color, per explicit
-- instruction: the two are genuinely different pieces of information, and
-- decoration_color must stay free to be empty for a Gender Reveal cake.
-- Always null for every other product/design (the client code only ever
-- sends it for styleId === "gender-reveal").

alter table public.order_items
  add column if not exists inside_color text;

comment on column public.order_items.inside_color is
  'Gender Reveal only: the colour inside the cake ("Rose" / "Bleu"). Null for every other product/design. Distinct from decoration_color.';
