-- F1 — Commandes de test + suivi du retrait de cashback dû aux remboursements.
--
-- Lot « Annulations, remboursements et chiffres » (plan v3, validé le
-- 01.10.2026). Additif uniquement, relançable.
--
-- orders.is_test : une commande de test garde TOUTE la logique (cashback,
-- doublons, plafond…) mais est exclue des chiffres réels, de la section
-- Remboursements par défaut et de l'export Excel. Aucune commande n'est
-- marquée ici : le marquage se fait plus tard, par un script séparé, après
-- validation de la liste par les propriétaires. Rien n'est supprimé.
--
-- orders.cashback_refund_adjustment : montant de cashback DÉJÀ retiré à cause
-- des remboursements de cette commande. recompute_order_cashback (F4)
-- n'applique que la différence avec ce montant → un remboursement n'ajuste le
-- cashback qu'une seule fois, même rejoué. Initialisé en F4.

begin;

alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists test_marked_at timestamptz,
  add column if not exists test_marked_by text,
  add column if not exists cashback_refund_adjustment numeric(12,2) not null default 0;

comment on column public.orders.is_test is
  'TRUE = commande de test : toute la logique s''applique, mais elle est exclue des chiffres réels, des exports et masquée par défaut dans l''admin. Jamais supprimée.';
comment on column public.orders.cashback_refund_adjustment is
  'Cashback déjà retiré du lot « earned » de cette commande à cause de ses remboursements comptés. Géré uniquement par recompute_order_cashback().';

create index if not exists orders_is_test_idx on public.orders (is_test) where is_test;

commit;
