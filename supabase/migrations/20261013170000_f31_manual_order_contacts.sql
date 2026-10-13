-- F31 — Coordonnées facultatives des commandes manuelles (13.10.2026).
--
-- À appliquer après F30. Additive, relançable. Le checkout du site ne change pas.
--   * orders.customer_instagram : pseudo Instagram (« @pseudo ») d'une commande
--     prise par message. Téléphone et e-mail restent des colonnes non nulles
--     (chaîne vide quand ils ne sont pas connus, comme avant pour l'e-mail).
--   * orders.cancellation_status accepte 'skipped' : commande annulée sans
--     e-mail d'annulation (aucune adresse, ou commande historique).

begin;

alter table public.orders add column if not exists customer_instagram text;
alter table public.orders drop constraint if exists orders_customer_instagram_check;
alter table public.orders add constraint orders_customer_instagram_check
  check (customer_instagram is null or customer_instagram ~ '^@[A-Za-z0-9._]{1,30}$');
comment on column public.orders.customer_instagram is 'F31 : pseudo Instagram de la cliente (commande manuelle), « @pseudo ».';

alter table public.orders drop constraint if exists orders_cancellation_status_check;
alter table public.orders add constraint orders_cancellation_status_check
  check (cancellation_status is null or cancellation_status = any (array['processing', 'sent', 'error', 'skipped']));

commit;
