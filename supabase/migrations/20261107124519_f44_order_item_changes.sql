-- F44 (07.11.2026) — Modification d'un gâteau déjà commandé (Admin > commande).
-- Les clientes demandent parfois de changer une couleur, un goût ou le texte.
-- Chaque modification est gardée ici : qui, quand, l'ancienne et la nouvelle
-- valeur, et la note (obligatoire quand le nouveau goût coûte plus cher : le
-- supplément n'est pas facturé automatiquement). Le prix de la commande, la
-- facture et le paiement ne changent jamais.
-- Écrit et lu seulement par la fonction edit-order-item (service role).
begin;

create table if not exists public.order_item_changes (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  item_id      uuid not null references public.order_items(id) on delete cascade,
  field        text not null check (field in (
                 'flavors', 'base_color', 'decoration_color', 'text_color', 'cake_text',
                 'text_style', 'ribbon_color', 'butterfly_color', 'item_comment')),
  old_value    text,
  new_value    text,
  note         text check (note is null or length(note) <= 1000),
  author_email text not null,
  author_name  text,
  created_at   timestamptz not null default now()
);

create index if not exists order_item_changes_order_idx on public.order_item_changes (order_id, created_at);

alter table public.order_item_changes enable row level security;
-- Pas de policy : seule la fonction (service role) passe.
revoke all on table public.order_item_changes from public, anon, authenticated;
grant all on table public.order_item_changes to service_role;

comment on table public.order_item_changes is
  'F44 — history of changes made by Mel/Eli to an ordered cake (colours, flavour, text, instructions). Written only by edit-order-item. Price never changes.';

commit;

-- Contrôles (attendu : 0 | 0) :
-- select count(*) from public.order_item_changes;
-- select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_item_changes';
--
-- ROLLBACK (seulement si besoin, avant toute vraie modification) :
-- drop table if exists public.order_item_changes;
