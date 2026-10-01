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
-- Cashback et remboursements (F4/F5) :
--   cashback_refund_target     : retrait VISÉ au dernier recalcul ;
--   cashback_refund_adjustment : retrait RÉELLEMENT appliqué au lot (peut être
--                                inférieur si le cashback était déjà dépensé) ;
--   cashback_needs_review      : historique ambigu → aucune restitution
--                                automatique, anomalie signalée ;
--   cashback_refund_initialized_at : initialisation faite par F5.
-- Seule la variation du retrait visé déclenche un mouvement : un
-- remboursement n'ajuste le cashback qu'une seule fois, et une correction ne
-- rend jamais plus que ce qui a réellement été retiré.

begin;

alter table public.orders
  add column if not exists is_test boolean not null default false,
  add column if not exists test_marked_at timestamptz,
  add column if not exists test_marked_by text,
  add column if not exists cashback_refund_adjustment numeric(12,2) not null default 0,
  add column if not exists cashback_refund_target numeric(12,2) not null default 0,
  add column if not exists cashback_needs_review boolean not null default false,
  add column if not exists cashback_refund_initialized_at timestamptz;

comment on column public.orders.is_test is
  'TRUE = commande de test : toute la logique s''applique, mais elle est exclue des chiffres réels, des exports et masquée par défaut dans l''admin. Jamais supprimée.';
comment on column public.orders.cashback_refund_adjustment is
  'Cashback RÉELLEMENT retiré du lot « earned » de cette commande à cause de ses remboursements (jamais un montant théorique). Une correction ne peut jamais rendre plus que ce montant. Géré uniquement par recompute_order_cashback().';
comment on column public.orders.cashback_refund_target is
  'Retrait de cashback visé au dernier recalcul (3,5 % des remboursements comptés). Seule sa variation déclenche un retrait ou une restitution.';
comment on column public.orders.cashback_needs_review is
  'TRUE quand l''historique du lot de cashback est ambigu (retrait réel impossible à établir) : aucune restitution automatique, anomalie signalée.';

create index if not exists orders_is_test_idx on public.orders (is_test) where is_test;

commit;
