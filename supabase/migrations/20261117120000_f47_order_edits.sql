-- F47 (17.11.2026) — Modifier une commande déjà payée (site ou manuelle).
--
-- Mel peut tout changer dans une commande déjà payée : taille, forme, goût,
-- design, extras, bougies, texte, date, retrait / livraison, ajouter ou
-- retirer un gâteau. Le serveur recalcule le prix ; la différence est réglée
-- ainsi (choix de Mel, 17.11.2026) :
--   - prix plus haut  → supplément à payer par lien de paiement (ou payé à la
--                       main : TWINT, cash…) ;
--   - prix plus bas   → remboursement (décision dans les Remboursements, comme
--                       un geste) OU « différence gardée » (modification
--                       après le délai) : le total reste celui payé, la
--                       facture montre une ligne « Différence non remboursée ».
--
--   order_edits            une ligne par modification enregistrée : avant /
--                          après, ancien / nouveau total, règlement, qui, quand.
--                          Le supplément éventuel vit sur cette ligne.
--   orders.edit_kept_amount  différence gardée (comprise dans total_amount).
--   order_payment_links.edit_id  lien de paiement d'un supplément.
--
-- Montants : total_amount = prix réel + edit_kept_amount. paid_amount (figé
-- au premier changement de prix) = ce qui est encaissé ; il augmente quand
-- un supplément est payé. Encaissé (compta, plafond des remboursements) =
-- paid_amount, comme aujourd'hui.
--
-- Commandes existantes : rien n'est modifié (edit_kept_amount = 0).
-- Écritures : uniquement via les Edge Functions (service_role).

-- ── 0. Garde : payment_link_begin en production = version F41 ─────────
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.payment_link_begin(text)'::regprocedure) into v_def;
  if position('perform public._manual_order_check_payable(v_order);' in v_def) = 0
     or position('edit_id' in v_def) > 0 then
    raise exception 'F47 : payment_link_begin en production ne correspond pas à la version F41 attendue — rien n''est appliqué';
  end if;
end $$;

-- ── 1. Colonnes et table ───────────────────────────────────────────────
alter table public.orders add column if not exists edit_kept_amount numeric(10,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_edit_kept_amount_check') then
    alter table public.orders add constraint orders_edit_kept_amount_check check (edit_kept_amount >= 0);
  end if;
end $$;

create table if not exists public.order_edits (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders(id) on delete cascade,
  old_total              numeric(10,2) not null,
  new_total              numeric(10,2) not null,
  -- Changement du prix réel (articles + livraison + express + ajustement).
  price_change           numeric(10,2) not null,
  settlement             text not null check (settlement in ('none', 'supplement', 'refund', 'kept')),
  -- Différence gardée ajoutée (> 0) ou reprise sur un ajout de prix (absorbed).
  kept_amount            numeric(10,2) not null default 0 check (kept_amount >= 0),
  absorbed_amount        numeric(10,2) not null default 0 check (absorbed_amount >= 0),
  refund_amount          numeric(10,2) not null default 0 check (refund_amount >= 0),
  refund_decision_id     uuid references public.order_refund_decisions(id),
  -- Supplément à payer créé par cette modification (il remplace un
  -- supplément encore dû d'une modification précédente).
  supplement_amount      numeric(10,2) not null default 0 check (supplement_amount >= 0),
  supplement_status      text check (supplement_status in ('due', 'paid', 'replaced')),
  supplement_paid_at     timestamptz,
  supplement_method      text check (supplement_method in ('cash', 'twint', 'bank_transfer', 'card', 'other', 'postfinance')),
  supplement_tx          text unique,
  supplement_attempt_id  uuid references public.order_payment_attempts(id),
  supplement_note        text,
  supplement_recorded_by text,
  summary                text,
  before                 jsonb,
  after                  jsonb,
  note                   text check (note is null or length(note) <= 1000),
  author_email           text not null,
  author_name            text,
  created_at             timestamptz not null default now(),
  check ((supplement_amount > 0) = (supplement_status is not null))
);
create index if not exists order_edits_order_idx on public.order_edits (order_id, created_at);
-- Un seul supplément dû à la fois par commande.
create unique index if not exists order_edits_one_due on public.order_edits (order_id) where supplement_status = 'due';

alter table public.order_edits enable row level security;
revoke all on table public.order_edits from public, anon, authenticated;
grant all on table public.order_edits to service_role;

alter table public.order_payment_links add column if not exists edit_id uuid references public.order_edits(id);

comment on table public.order_edits is
  'F47 — every change Mel/Eli made to an already-paid order (website or manual): before/after, totals, supplement to pay or refund. Written only by manage-manual-order.';
comment on column public.orders.edit_kept_amount is
  'F47 — price difference kept after a late change (not refunded); included in total_amount, printed on the invoice.';

-- ── 2. Enregistrer une modification (sous verrou de la commande) ──────
-- Appelée APRÈS l'écriture des articles et des dates (la fonction remet
-- l'ancien contenu si cet appel échoue). Calcule le nouveau total à partir
-- du changement de prix réel, crée le supplément ou la décision de
-- remboursement, et écrit l'historique. Tout ou rien.
--   p_expected_total : total lu par l'écran ; refus (P0020) s'il a changé.
--   p_choice         : 'refund' ou 'kept' (utilisé seulement si le prix baisse).
create or replace function public.order_edit_commit(
  p_order_id       uuid,
  p_expected_total numeric,
  p_price_change   numeric,
  p_choice         text,
  p_summary        text,
  p_before         jsonb,
  p_after          jsonb,
  p_note           text,
  p_by             text,
  p_by_name        text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order     public.orders%rowtype;
  v_change    numeric := round(coalesce(p_price_change, 0), 2);
  v_kept_old  numeric;
  v_kept_new  numeric;
  v_due_prev  numeric;
  v_due_new   numeric;
  v_absorbed  numeric := 0;
  v_reduce    numeric := 0;
  v_rest      numeric := 0;
  v_refund    numeric := 0;
  v_kept_add  numeric := 0;
  v_real_old  numeric;
  v_new_total numeric;
  v_settle    text := 'none';
  v_edit_id   uuid := gen_random_uuid();
  v_decision  uuid;
  v_awaiting  boolean;
begin
  if p_choice is not null and p_choice not in ('refund', 'kept') then
    raise exception 'Choix inconnu : %', p_choice using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Commande introuvable' using errcode = 'P0002'; end if;
  if v_order.order_validation in ('cancelled', 'rejected') or v_order.order_failure_reason is not null then
    raise exception 'Commande annulée : modification impossible' using errcode = 'P0012';
  end if;
  if round(coalesce(v_order.total_amount, 0), 2) <> round(coalesce(p_expected_total, 0), 2) then
    raise exception 'La commande a changé entre-temps : rechargez la page' using errcode = 'P0020';
  end if;
  -- Commande du site pas encore acceptée : le paiement est seulement
  -- autorisé, son montant ne peut pas changer (le reste se modifie).
  v_awaiting := v_order.created_via is distinct from 'admin' and v_order.payment_status in ('pending', 'paid')
    and (v_order.physical_validation = 'pending'
         or (v_order.physical_validation = 'not_applicable' and v_order.order_validation = 'pending'));
  if v_awaiting and v_change <> 0 then
    raise exception 'Acceptez d''abord la commande (le paiement est encaissé), puis modifiez le prix' using errcode = 'P0022';
  end if;
  if v_order.payment_status <> 'paid' and not v_awaiting then
    raise exception 'Seule une commande payée se modifie ici (payment_status = %)', v_order.payment_status using errcode = 'P0013';
  end if;

  v_kept_old := round(coalesce(v_order.edit_kept_amount, 0), 2);
  select coalesce(round(sum(supplement_amount), 2), 0) into v_due_prev
  from public.order_edits where order_id = p_order_id and supplement_status = 'due';
  v_real_old := round(coalesce(v_order.total_amount, 0) - v_kept_old, 2);
  v_kept_new := v_kept_old;
  v_due_new := v_due_prev;

  if v_change > 0 then
    -- Une différence gardée plus tôt paie d'abord la hausse.
    v_absorbed := least(v_kept_old, v_change);
    v_kept_new := v_kept_old - v_absorbed;
    v_due_new := v_due_prev + (v_change - v_absorbed);
  elsif v_change < 0 then
    -- Un supplément pas encore payé baisse d'abord.
    v_reduce := least(v_due_prev, -v_change);
    v_due_new := v_due_prev - v_reduce;
    v_rest := -v_change - v_reduce;
    if v_rest > 0 then
      if p_choice is null then
        raise exception 'Choisissez : rembourser ou garder la différence' using errcode = '22023';
      end if;
      if p_choice = 'refund' then v_refund := v_rest; else v_kept_add := v_rest; v_kept_new := v_kept_old + v_rest; end if;
    end if;
  end if;

  v_new_total := round(v_real_old + v_change + v_kept_new, 2);
  v_settle := case
    when v_refund > 0 then 'refund'
    when v_kept_add > 0 then 'kept'
    when v_due_new <> v_due_prev then 'supplement'
    else 'none' end;

  -- Encaissé figé avant le premier changement de prix.
  if v_change <> 0 then
    update public.orders
    set paid_amount      = coalesce(paid_amount, total_amount),
        total_amount     = v_new_total,
        edit_kept_amount = v_kept_new,
        last_edited_at   = now()
    where id = p_order_id;
  else
    update public.orders set last_edited_at = now() where id = p_order_id;
  end if;

  -- Supplément dû : l'ancien est remplacé par le nouveau montant.
  if v_due_new <> v_due_prev then
    update public.order_payment_links
    set status = 'disabled', disabled_at = now(), disabled_by = coalesce(p_by, 'système'),
        disabled_reason = 'Remplacé par une nouvelle modification'
    where order_id = p_order_id and status = 'active'
      and edit_id in (select id from public.order_edits where order_id = p_order_id and supplement_status = 'due');
    update public.order_edits set supplement_status = 'replaced'
    where order_id = p_order_id and supplement_status = 'due';
  end if;

  insert into public.order_edits (
    id, order_id, old_total, new_total, price_change, settlement, kept_amount, absorbed_amount, refund_amount,
    supplement_amount, supplement_status, summary, before, after, note, author_email, author_name)
  values (
    v_edit_id, p_order_id, round(coalesce(v_order.total_amount, 0), 2), v_new_total, v_change, v_settle, v_kept_add, v_absorbed, v_refund,
    case when v_due_new <> v_due_prev then v_due_new else 0 end,
    case when v_due_new <> v_due_prev and v_due_new > 0 then 'due' end,
    nullif(btrim(coalesce(p_summary, '')), ''), p_before, p_after, nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_by, 'admin'), p_by_name);

  if v_refund > 0 then
    -- Même registre que les gestes : à rembourser ensuite dans « Remboursements ».
    v_decision := public.record_refund_decision(
      p_order_id, v_refund, 'Modification de commande : prix plus bas', 'admin_gesture',
      'order-edit-' || v_edit_id::text, null, p_by);
    update public.order_edits set refund_decision_id = v_decision where id = v_edit_id;
  end if;

  return jsonb_build_object(
    'edit_id', v_edit_id, 'old_total', round(coalesce(v_order.total_amount, 0), 2), 'new_total', v_new_total,
    'price_change', v_change, 'settlement', v_settle, 'supplement_due', v_due_new,
    'supplement_created', v_due_new <> v_due_prev and v_due_new > 0,
    'refund', v_refund, 'kept_added', v_kept_add, 'absorbed', v_absorbed, 'kept_total', v_kept_new,
    'refund_decision_id', v_decision);
end $$;

-- ── 3. Lien de paiement d'un supplément ────────────────────────────────
-- Renvoie le lien actif du supplément, sinon le crée (un seul lien actif
-- par commande : un ancien lien actif est désactivé).
create or replace function public.order_edit_supplement_link(p_edit_id uuid, p_token text, p_by text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_edit  public.order_edits%rowtype;
  v_order public.orders%rowtype;
  v_link  public.order_payment_links%rowtype;
begin
  select * into v_edit from public.order_edits where id = p_edit_id for update;
  if not found then raise exception 'Modification introuvable' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_edit.order_id for update;
  if v_order.order_validation in ('cancelled', 'rejected') or v_order.order_failure_reason is not null then
    raise exception 'Commande annulée' using errcode = 'P0012';
  end if;
  if v_edit.supplement_status is distinct from 'due' then
    raise exception 'Aucun supplément à payer' using errcode = 'P0016';
  end if;

  select * into v_link from public.order_payment_links where order_id = v_edit.order_id and status = 'active';
  if found and v_link.edit_id = p_edit_id then
    return jsonb_build_object('link_id', v_link.id, 'token', v_link.token, 'created', false, 'created_at', v_link.created_at);
  end if;
  if found then
    update public.order_payment_links
    set status = 'disabled', disabled_at = now(), disabled_by = coalesce(p_by, 'système'), disabled_reason = 'Remplacé par le lien du supplément'
    where id = v_link.id;
  end if;

  insert into public.order_payment_links (order_id, token, send_confirmation, created_by, edit_id)
  values (v_edit.order_id, p_token, false, p_by, p_edit_id)
  returning * into v_link;
  return jsonb_build_object('link_id', v_link.id, 'token', v_link.token, 'created', true, 'created_at', v_link.created_at);
end $$;

-- ── 4. Supplément payé (lien PostFinance ou à la main) ─────────────────
-- Idempotent par transaction PostFinance. paid_amount augmente du montant.
create or replace function public.record_order_supplement_payment(
  p_edit_id    uuid,
  p_method     text,
  p_paid_at    timestamptz default now(),
  p_note       text default null,
  p_by         text default null,
  p_attempt_id uuid default null,
  p_tx         text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_edit  public.order_edits%rowtype;
  v_order public.orders%rowtype;
begin
  if p_tx is not null then
    select * into v_edit from public.order_edits where supplement_tx = p_tx;
    if found then
      return jsonb_build_object('edit_id', v_edit.id, 'already', true, 'amount', v_edit.supplement_amount, 'order_id', v_edit.order_id);
    end if;
  end if;
  if p_method is null or p_method not in ('cash', 'twint', 'bank_transfer', 'card', 'other', 'postfinance') then
    raise exception 'Invalid payment method: %', p_method using errcode = '22023';
  end if;

  select * into v_edit from public.order_edits where id = p_edit_id for update;
  if not found then raise exception 'Modification introuvable' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_edit.order_id for update;
  if v_order.order_validation in ('cancelled', 'rejected') or v_order.order_failure_reason is not null then
    raise exception 'Commande annulée' using errcode = 'P0012';
  end if;
  if v_edit.supplement_status is distinct from 'due' then
    raise exception 'Ce supplément n''est plus à payer' using errcode = 'P0013';
  end if;

  update public.order_edits
  set supplement_status = 'paid', supplement_paid_at = coalesce(p_paid_at, now()), supplement_method = p_method,
      supplement_tx = p_tx, supplement_attempt_id = p_attempt_id,
      supplement_note = nullif(btrim(coalesce(p_note, '')), ''), supplement_recorded_by = p_by
  where id = p_edit_id;

  update public.orders
  set paid_amount = round(coalesce(paid_amount, total_amount - v_edit.supplement_amount) + v_edit.supplement_amount, 2),
      last_edited_at = now()
  where id = v_edit.order_id;

  update public.order_payment_links set status = 'paid', paid_at = now()
  where edit_id = p_edit_id and status = 'active';

  return jsonb_build_object('edit_id', p_edit_id, 'already', false, 'amount', v_edit.supplement_amount, 'order_id', v_edit.order_id,
    'order_number', v_order.order_number);
end $$;

-- ── 5. payment_link_begin : aussi pour un supplément ───────────────────
-- Identique à F41 pour les liens de solde ; un lien de supplément paie le
-- supplément encore dû de sa modification.
create or replace function public.payment_link_begin(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_link    public.order_payment_links%rowtype;
  v_order   public.orders%rowtype;
  v_edit    public.order_edits%rowtype;
  v_balance numeric;
  v_att     public.order_payment_attempts%rowtype;
begin
  select * into v_link from public.order_payment_links where token = p_token for update;
  if not found then raise exception 'Lien introuvable' using errcode = 'P0002'; end if;
  if v_link.status <> 'active' then
    raise exception 'link_%', v_link.status using errcode = 'P0015';
  end if;

  select * into v_order from public.orders where id = v_link.order_id for update;
  if v_link.edit_id is not null then
    if v_order.order_validation in ('cancelled', 'rejected') or v_order.order_failure_reason is not null then
      raise exception 'link_unpayable' using errcode = 'P0015';
    end if;
    select * into v_edit from public.order_edits where id = v_link.edit_id for update;
    if v_edit.supplement_status = 'paid' then raise exception 'link_paid' using errcode = 'P0015'; end if;
    if v_edit.supplement_status is distinct from 'due' then raise exception 'link_disabled' using errcode = 'P0015'; end if;
    v_balance := round(v_edit.supplement_amount, 2);
  else
    begin
      perform public._manual_order_check_payable(v_order);
    exception when others then
      raise exception 'link_unpayable' using errcode = 'P0015';
    end;
    v_balance := round(coalesce(v_order.total_amount, 0) - public._manual_order_paid_sum(v_order.id), 2);
  end if;
  if v_balance <= 0 then raise exception 'link_paid' using errcode = 'P0015'; end if;

  select * into v_att from public.order_payment_attempts
  where link_id = v_link.id and status in ('creating', 'pending') and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if found then
    if v_att.status = 'creating' and v_att.created_at > now() - interval '2 minutes' then
      return jsonb_build_object('in_progress', true);
    end if;
    if v_att.status = 'pending' and v_att.amount = v_balance and v_att.transaction_id is not null then
      return jsonb_build_object('reuse', true, 'attempt_id', v_att.id, 'transaction_id', v_att.transaction_id, 'amount', v_att.amount);
    end if;
  end if;

  insert into public.order_payment_attempts (link_id, order_id, amount)
  values (v_link.id, v_order.id, v_balance) returning * into v_att;
  return jsonb_build_object('attempt_id', v_att.id, 'amount', v_balance, 'order_id', v_order.id,
    'order_number', v_order.order_number, 'email', v_order.email, 'lang', v_order.lang,
    'supplement', v_link.edit_id is not null);
end $$;

-- ── 6. Droits ──────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.order_edit_commit(uuid, numeric, numeric, text, text, jsonb, jsonb, text, text, text)',
    'public.order_edit_supplement_link(uuid, text, text)',
    'public.record_order_supplement_payment(uuid, text, timestamptz, text, text, uuid, text)',
    'public.payment_link_begin(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Contrôles (attendu : 0 | 0 | 0) :
-- select count(*) from public.order_edits;
-- select count(*) from public.orders where edit_kept_amount <> 0;
-- select count(*) from public.order_payment_links where edit_id is not null;
--
-- ROLLBACK (seulement avant toute vraie modification) : remettre
-- payment_link_begin de 20261104165512_f41 (section 6), puis
-- drop function public.order_edit_commit(uuid, numeric, numeric, text, text, jsonb, jsonb, text, text, text);
-- drop function public.order_edit_supplement_link(uuid, text, text);
-- drop function public.record_order_supplement_payment(uuid, text, timestamptz, text, text, uuid, text);
-- alter table public.order_payment_links drop column edit_id;
-- drop table public.order_edits;
-- alter table public.orders drop column edit_kept_amount;
