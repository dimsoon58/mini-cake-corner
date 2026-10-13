-- F29 — Envoyer / renvoyer la confirmation depuis l'admin (13.10.2026).
--
-- À appliquer après F17 (sales_lines) et F3 (order_refund_summary).
-- Additive, relançable. Service role uniquement. Ne touche ni aux
-- commandes, ni aux paiements, ni aux réservations, ni à la compta : une
-- table d'historique et une fonction de LECTURE.
--
--   * order_email_events : chaque renvoi (confirmation, « Commande reçue »)
--     et chaque correction de l'e-mail d'une commande — date, adresse,
--     ancienne adresse, qui, résultat Resend. La ligne « sending » sert de
--     verrou : un double clic ou une seconde fenêtre ne peut pas envoyer deux
--     fois (index unique partiel + clé d'idempotence).
--   * order_confirmation_money(order) : ce que l'e-mail affiche — total des
--     lignes encore confirmées (sales_lines, mêmes montants que la compta),
--     encaissé, remboursé, remboursement encore dû — lu, jamais recalculé
--     ni écrit.

begin;

create table if not exists public.order_email_events (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  kind             text not null check (kind in ('confirmation', 'payment_due', 'order_received', 'email_change')),
  email            text not null,
  previous_email   text,
  status           text not null check (status in ('sending', 'sent', 'error', 'done')),
  idempotency_key  text not null unique,
  resend_email_id  text,
  invoice          text check (invoice in ('stored', 'none', 'not_current')),
  error            text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists order_email_events_order_idx on public.order_email_events (order_id, created_at desc);
-- Un seul envoi en cours par commande.
create unique index if not exists order_email_events_one_sending
  on public.order_email_events (order_id) where status = 'sending';

alter table public.order_email_events enable row level security;
revoke all on public.order_email_events from anon, authenticated;
grant select, insert, update on public.order_email_events to service_role;

-- ── Montants affichés dans la confirmation (lecture seule) ──────────────
create or replace function public.order_confirmation_money(p_order_id uuid)
returns table (
  in_sales        boolean,   -- la commande a des lignes de vente (acceptée / manuelle)
  kept_total      numeric,   -- lignes encore confirmées (articles, places, livraison)
  cancelled_total numeric,   -- lignes annulées ou refusées
  collected       numeric,   -- encaissé
  refunded        numeric,   -- remboursé (comptés)
  refund_due      numeric    -- remboursement encore dû
)
language sql
stable
set search_path to ''
as $$
  with l as (
    select state, amount from public.sales_lines(true) where order_id = p_order_id
  ),
  agg as (
    select count(*) > 0 as in_sales,
           coalesce(round(sum(amount) filter (where state = 'kept'), 2), 0) as kept_total,
           coalesce(round(sum(amount) filter (where state in ('cancelled', 'refused')), 2), 0) as cancelled_total
    from l
  ),
  s as (select * from public.order_refund_summary(p_order_id))
  select a.in_sales, a.kept_total, a.cancelled_total, s.collected, s.refunded,
         -- dû = ce qui a été décidé et pas encore remboursé, ou ce qui a été
         -- annulé et pas encore remboursé — jamais plus que ce qui reste encaissé.
         least(greatest(s.remaining, a.cancelled_total - s.refunded, 0), greatest(s.collected - s.refunded, 0)) as refund_due
  from agg a, s;
$$;

revoke all on function public.order_confirmation_money(uuid) from public, anon, authenticated;
grant execute on function public.order_confirmation_money(uuid) to service_role;

commit;
