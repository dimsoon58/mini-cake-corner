-- F46 (16.11.2026) — Options offertes sur les commandes manuelles.
-- L'admin peut rendre gratuite une option d'un article (design, extra,
-- parfum, bougies, fruits…) ou l'article entier. Le prix normal est
-- toujours calculé par le moteur du site ; le montant offert est retiré de
-- order_items.total et gardé à part pour la ligne « Offert » de la facture.
--   free_options : clés des lignes offertes (« design:mini-heart »,
--                  « extra:gold-leaves », « all » = article entier).
--   free_amount  : montant offert en CHF (déjà déduit de total).
--   free_label   : texte de la ligne de facture, dans la langue du client.
-- NULL / vide = rien d'offert (toutes les commandes existantes et le site).
alter table public.order_items
  add column if not exists free_options text[],
  add column if not exists free_amount numeric(10,2)
    check (free_amount is null or free_amount > 0),
  add column if not exists free_label text;

comment on column public.order_items.free_options is
  'Commande manuelle : clés des options offertes (kind:id, ou all = article entier). NULL = rien d''offert.';
comment on column public.order_items.free_amount is
  'Commande manuelle : montant offert (CHF), déjà déduit de total. NULL = rien d''offert.';
comment on column public.order_items.free_label is
  'Commande manuelle : libellé de la ligne « Offert » de la facture (langue du client).';
