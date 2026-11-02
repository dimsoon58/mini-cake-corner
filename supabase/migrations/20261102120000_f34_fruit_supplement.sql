-- F34 (02.11.2026) — Supplément fruits sur les commandes manuelles.
-- Montant en CHF choisi par l'admin pour un gâteau (fruits frais en
-- décoration). Déjà compris dans order_items.total ; gardé à part pour la
-- ligne « Supplément fruits » de la facture, l'Admin et Aujourd'hui.
-- NULL = pas de fruits (toutes les commandes existantes et celles du site).
alter table public.order_items
  add column if not exists fruit_supplement numeric(10,2)
    check (fruit_supplement is null or (fruit_supplement > 0 and fruit_supplement <= 500));

comment on column public.order_items.fruit_supplement is
  'Supplément fruits (CHF) choisi par l''admin sur une commande manuelle ; compris dans total. NULL = pas de fruits.';
