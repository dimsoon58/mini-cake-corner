-- F49 (26.11.2026) — Extras libres sur les commandes de l'admin.
-- L'admin tape lui-même ce qu'est l'extra (« Topper doré ») et son prix.
-- Le montant est DÉJÀ compris dans order_items.total (calculé par le serveur,
-- comme le supplément fruits) ; la liste est gardée à part pour les lignes
-- de la facture, le récapitulatif de paiement et l'admin.
--   custom_extras : [{ "label": "Topper doré", "amount": 12 }, …]
-- NULL = aucun extra libre (toutes les commandes existantes et le site).
alter table public.order_items
  add column if not exists custom_extras jsonb
    check (custom_extras is null or jsonb_typeof(custom_extras) = 'array');

comment on column public.order_items.custom_extras is
  'Admin : extras libres [{label, amount}] (CHF), déjà compris dans total. NULL = aucun.';
