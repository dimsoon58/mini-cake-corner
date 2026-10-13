-- F30 — Commandes historiques (13.10.2026).
--
-- Commandes réalisées avant le lancement du site (dont octobre), saisies
-- dans l'admin uniquement pour compléter la comptabilité. Additive,
-- relançable. Ne touche à aucune commande existante (défaut false).
--
-- orders.is_historical = true :
--   * aucun e-mail ne part jamais (manage-manual-order, send-manual-order-
--     confirmation et resend-order-confirmation le refusent) ;
--   * dates passées permises, pas de supplément express, pas de workshop ;
--   * comptée normalement en compta (mois de réalisation = date de la
--     commande, mois d'encaissement = date du paiement enregistré).

begin;

alter table public.orders add column if not exists is_historical boolean not null default false;
comment on column public.orders.is_historical is
  'F30 : commande réalisée avant le site, saisie pour la compta — aucun e-mail, jamais à préparer si déjà remise.';

commit;
