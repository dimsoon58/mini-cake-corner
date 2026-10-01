-- F2 — Registre unique des remboursements effectués + registre des décisions.
--
-- Plan v3 §4.2 / §4.3. Additif uniquement, relançable. Ne change aucun
-- comportement tant que F3–F5 ne sont pas appliquées.
--
-- 1. order_manual_refunds devient LE registre des remboursements réellement
--    effectués, quelle que soit leur origine :
--      source = 'admin'       saisie dans la fiche commande
--               'make_notion' recopie automatique de order_refunds (Make,
--                             scénario 7425367 module 48 — inchangé)
--               'workshop'    confirmation d'un remboursement workshop
--    status  = 'counted'   compté dans les totaux, l'Excel et le cashback
--              'to_review' à vérifier (doublon possible / dépasse l'encaissé) :
--                          JAMAIS additionné, mais pris en compte dans le
--                          contrôle du plafond (sans réserver deux fois un
--                          doublon suspecté — voir refund_reserved_amount, F3)
--              'duplicate' doublon confirmé, hors totaux
--              'rejected'  entrée invalide (non encaissée, article étranger…)
--              'voided'    saisie corrigée par un admin, hors totaux
--    Les lignes existantes restent 'counted' (comportement actuel). Leur date
--    réelle est inconnue : refunded_at reste NULL (« à dater »), jamais
--    inventée.
--
-- 2. order_manual_refund_items : un remboursement peut viser plusieurs
--    articles. L'ancien order_item_id (un seul article) est recopié.
--
-- 3. order_refund_decisions : les montants que l'on DÉCIDE de rendre.
--    Reste à rembourser = Σ décisions actives − Σ remboursements comptés.
--    Chaque remboursement compté est couvert par des décisions (au besoin
--    une décision 'auto_from_refund' pour l'excédent, liée au remboursement),
--    donc remboursé ≤ décidé, et rien n'est soustrait deux fois.
--
-- 4. refund_ingest_errors : si la recopie automatique d'une ligne Make échoue
--    de façon inattendue, l'erreur est notée ici au lieu de faire échouer
--    l'appel de Make.
--
-- Tables réservées au service_role (même règle que les autres tables
-- internes) : RLS activée, aucune politique ouverte, aucun droit anon /
-- authenticated.

begin;

-- ── 1. Registre des remboursements effectués ─────────────────────────────
alter table public.order_manual_refunds
  add column if not exists refunded_at       timestamptz,
  add column if not exists method            text,
  add column if not exists method_detail     text,
  add column if not exists reference         text,
  add column if not exists idempotency_key   text,
  add column if not exists source            text not null default 'admin',
  add column if not exists source_ref        text,
  add column if not exists status            text not null default 'counted',
  add column if not exists review_reason     text,
  add column if not exists duplicate_of      uuid references public.order_manual_refunds(id),
  add column if not exists reviewed_at       timestamptz,
  add column if not exists reviewed_by       text,
  add column if not exists voided_at         timestamptz,
  add column if not exists voided_by         text,
  add column if not exists void_reason       text,
  add column if not exists updated_at        timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_manual_refunds_method_check') then
    alter table public.order_manual_refunds add constraint order_manual_refunds_method_check
      check (method is null or method in ('postfinance', 'twint', 'bank_transfer', 'cash', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_manual_refunds_source_check') then
    alter table public.order_manual_refunds add constraint order_manual_refunds_source_check
      check (source in ('admin', 'make_notion', 'workshop'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_manual_refunds_status_check') then
    alter table public.order_manual_refunds add constraint order_manual_refunds_status_check
      check (status in ('counted', 'to_review', 'duplicate', 'rejected', 'voided'));
  end if;
end $$;

create unique index if not exists order_manual_refunds_idempotency_key_uidx
  on public.order_manual_refunds (idempotency_key) where idempotency_key is not null;
create unique index if not exists order_manual_refunds_source_ref_uidx
  on public.order_manual_refunds (source, source_ref) where source_ref is not null;
create index if not exists order_manual_refunds_refunded_at_idx
  on public.order_manual_refunds (refunded_at);
create index if not exists order_manual_refunds_status_idx
  on public.order_manual_refunds (status);

comment on column public.order_manual_refunds.refunded_at is
  'Date réelle du remboursement. NULL uniquement pour les saisies antérieures à ce registre (« à dater ») — jamais inventée.';
comment on column public.order_manual_refunds.status is
  'counted = compté ; to_review = à vérifier (hors totaux, compté dans le plafond sans double réservation) ; duplicate / rejected / voided = hors totaux.';

-- ── 2. Articles visés par un remboursement ───────────────────────────────
create table if not exists public.order_manual_refund_items (
  refund_id     uuid not null references public.order_manual_refunds(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  primary key (refund_id, order_item_id)
);

insert into public.order_manual_refund_items (refund_id, order_item_id)
select r.id, r.order_item_id
from public.order_manual_refunds r
where r.order_item_id is not null
on conflict do nothing;

-- ── 3. Décisions de remboursement ────────────────────────────────────────
create table if not exists public.order_refund_decisions (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id),
  amount          numeric(10,2) not null check (amount > 0),
  reason          text,
  source          text not null check (source in ('admin_cancel', 'admin_gesture', 'make_cancel', 'workshop_cancel', 'auto_from_refund', 'legacy_due')),
  source_ref      text,
  refund_id       uuid references public.order_manual_refunds(id),
  idempotency_key text,
  decided_at      timestamptz not null default now(),
  decided_by      text,
  voided_at       timestamptz,
  voided_by       text,
  void_reason     text,
  created_at      timestamptz not null default now()
);

create index if not exists order_refund_decisions_order_id_idx on public.order_refund_decisions (order_id);
create unique index if not exists order_refund_decisions_source_ref_uidx
  on public.order_refund_decisions (source, source_ref) where source_ref is not null;
create unique index if not exists order_refund_decisions_idempotency_key_uidx
  on public.order_refund_decisions (idempotency_key) where idempotency_key is not null;
-- Au plus UNE décision automatique active par remboursement.
create unique index if not exists order_refund_decisions_auto_per_refund_uidx
  on public.order_refund_decisions (refund_id) where refund_id is not null and voided_at is null;

create table if not exists public.order_refund_decision_items (
  decision_id   uuid not null references public.order_refund_decisions(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  primary key (decision_id, order_item_id)
);

comment on table public.order_refund_decisions is
  'Montants décidés à rembourser. Reste à rembourser = Σ décisions actives (voided_at NULL) − Σ remboursements comptés (order_manual_refunds.status = counted).';

-- ── 4. Erreurs de recopie automatique ────────────────────────────────────
create table if not exists public.refund_ingest_errors (
  id         bigint generated always as identity primary key,
  source     text not null,
  source_ref text,
  order_id   uuid,
  error      text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ── Accès : service_role uniquement ──────────────────────────────────────
alter table public.order_manual_refund_items    enable row level security;
alter table public.order_refund_decisions       enable row level security;
alter table public.order_refund_decision_items  enable row level security;
alter table public.refund_ingest_errors         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['order_manual_refund_items', 'order_refund_decisions', 'order_refund_decision_items', 'refund_ingest_errors'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;
