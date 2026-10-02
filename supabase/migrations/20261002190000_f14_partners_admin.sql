-- F14 — Lot Partenaires (V1) : gestion des partenaires dans l'admin.
--
-- À appliquer après F13. Ne rejoue aucune migration. Ne modifie ni le lien
-- ?ref=, ni le paiement, ni les promotions : les règles actuelles du site
-- restent celles du paiement (create-postfinance-payment), qui fige sur
-- chaque commande le partenaire, ses taux, la base et la commission.
--
-- Règles V1 (validées) :
--   * Lien `?ref=<referral_token>` inchangé, jeton jamais régénéré ; dernier
--     lien valide de la session = partenaire retenu (règle actuelle du site).
--   * Aucun code promo au paiement. Le code éventuel de Notion est gardé comme
--     simple RÉFÉRENCE (promo_code_reference), jamais utilisable au paiement.
--   * L'attribution d'un partenaire se fait UNIQUEMENT automatiquement par
--     le site (lien) ; aucune attribution manuelle, aucun rabais partenaire
--     sur une commande manuelle.
--   * Partenaire avec commission mais SANS remise client : enregistrable ici
--     (remise 0 %). ATTENTION : la vérification du lien au paiement refuse
--     aujourd'hui une remise de 0 % ; tant que le paiement n'est pas adapté
--     (décision séparée), son lien n'attribue pas les commandes.
--   * Commission « calculée » ≠ « réellement due » : une commission n'est
--     présentée comme due que si les CONDITIONS du partenaire ont été
--     confirmées pour le taux figé sur la commande.
--   * P5 : annulation du gâteau par le client → la commission de CE gâteau
--     est retirée ; remboursement commercial (problème de notre côté),
--     partiel ou total → commission conservée. Le motif est explicite, par
--     remboursement ; sans motif : « À vérifier », rien n'est décidé seul.
--     Commission initiale et montants déjà versés restent visibles. Si une
--     commission retirée a déjà été versée : solde négatif à compenser sur un
--     prochain paiement, aucun mouvement d'argent automatique.
--   * Commission acquise seulement si la commande est encaissée.
--   * Commandes de test exclues. Rien n'est supprimé (désactivation,
--     annulations tracées). Historique dans compta_audit.
--
-- Additive, relançable. Aucune commande n'est modifiée par la migration.

begin;

-- ── Partenaires : colonnes de gestion ────────────────────────────────────
alter table public.partners add column if not exists commission_configured boolean not null default true;
alter table public.partners add column if not exists promo_code_reference text;   -- référence Notion, jamais utilisée au paiement
alter table public.partners add column if not exists notion_page_id text;
alter table public.partners add column if not exists updated_by text;
alter table public.partners add column if not exists deactivated_at timestamptz;

-- ── Historique des taux (le paiement lit toujours partners.*) ────────────
create table if not exists public.partner_rate_history (
  id                     uuid primary key default gen_random_uuid(),
  partner_id             uuid not null references public.partners(id),
  commission_rate        numeric(5,4) not null,
  customer_discount_rate numeric(5,4) not null,
  commission_configured  boolean not null,
  effective_from         date not null,
  note                   text,
  created_by             text,
  created_at             timestamptz not null default now()
);
insert into public.partner_rate_history (partner_id, commission_rate, customer_discount_rate, commission_configured, effective_from, note, created_by)
select p.id, p.commission_rate, p.customer_discount_rate, true, coalesce(p.start_date, p.created_at::date), 'Taux en place au moment de F14', 'migration'
from public.partners p
where not exists (select 1 from public.partner_rate_history h where h.partner_id = p.id);

-- ── Confirmation des conditions (pour un taux donné) ─────────────────────
create table if not exists public.partner_condition_confirmations (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id),
  commission_rate numeric(5,4) not null,
  terms           jsonb not null,
  confirmed_by    text,
  confirmed_at    timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      text,
  revoke_reason   text
);

-- ── Motif explicite d'un remboursement pour la commission (P5) ───────────
create table if not exists public.partner_refund_motifs (
  id         uuid not null default gen_random_uuid() unique,   -- pour l'historique
  refund_id  uuid primary key references public.order_manual_refunds(id),
  order_id   uuid not null references public.orders(id),
  motif      text not null check (motif in ('client_cancellation', 'commercial')),
  note       text,
  set_by     text,
  set_at     timestamptz not null default now()
);
create table if not exists public.partner_refund_cancelled_items (
  id            uuid not null default gen_random_uuid() unique,   -- pour l'historique
  refund_id     uuid not null references public.partner_refund_motifs(refund_id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  primary key (refund_id, order_item_id)
);

-- ── Paiements de commissions (table existante, jamais utilisée jusqu'ici) ─
alter table public.partner_payouts add column if not exists reference text;
alter table public.partner_payouts add column if not exists idempotency_key text;
alter table public.partner_payouts add column if not exists voided_at timestamptz;
alter table public.partner_payouts add column if not exists voided_by text;
alter table public.partner_payouts add column if not exists void_reason text;
create unique index if not exists partner_payouts_idem_uidx on public.partner_payouts (idempotency_key) where idempotency_key is not null;

do $$
declare t text;
begin
  foreach t in array array['partners', 'partner_rate_history', 'partner_condition_confirmations', 'partner_refund_motifs',
                           'partner_refund_cancelled_items', 'partner_payouts'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Calcul par commande ──────────────────────────────────────────────────
-- Statut de commission :
--   none        : pas de commission (taux 0, aucun article éligible…)
--   unpaid      : commande non encaissée → rien d'acquis
--   to_check    : un remboursement compté n'a pas de motif → rien n'est
--                 décidé automatiquement
--   earned      : acquise (montant = initiale − commissions des gâteaux
--                 annulés par le client)
create or replace function public.partner_order_commission(o public.orders)
returns jsonb language sql stable set search_path to '' as $$
  with
  paid as (select (o.paid_at is not null or o.payment_status in ('paid', 'refunded')) as v),
  refunds as (
    select m.id, m.amount, m.refunded_at, pm.motif, pm.note,
           coalesce((select jsonb_agg(c.order_item_id) from public.partner_refund_cancelled_items c where c.refund_id = m.id), '[]'::jsonb) as items
    from public.order_manual_refunds m left join public.partner_refund_motifs pm on pm.refund_id = m.id
    where m.order_id = o.id and m.status = 'counted'
  ),
  cancelled as (
    select distinct c.order_item_id from public.partner_refund_cancelled_items c
    join public.partner_refund_motifs pm on pm.refund_id = c.refund_id
    join public.order_manual_refunds m on m.id = pm.refund_id and m.status = 'counted'
    where pm.order_id = o.id and pm.motif = 'client_cancellation'
  ),
  x as (
    select
      round(coalesce(o.partner_commission_amount, 0), 2) as initial,
      round(coalesce(o.partner_commission_base, 0), 2) as base,
      coalesce((select sum(i.partner_commission_amount) from public.order_items i where i.order_id = o.id and i.id in (select order_item_id from cancelled)), 0) as cancelled_commission,
      (select count(*) from refunds where motif is null) as missing_motifs,
      (select v from paid) as paid,
      exists (select 1 from public.partner_condition_confirmations c
              where c.partner_id = o.partner_id and c.revoked_at is null and c.commission_rate = o.partner_commission_rate) as confirmed
  )
  select jsonb_build_object(
    'rate', o.partner_commission_rate,
    'base', x.base,
    'initial', x.initial,
    'cancelledCommission', round(x.cancelled_commission, 2),
    'confirmed', x.confirmed,
    'paid', x.paid,
    'status', case
      when not x.paid then 'unpaid'
      when x.missing_motifs > 0 then 'to_check'
      when x.initial = 0 then 'none'
      else 'earned' end,
    'toCheckReasons', to_jsonb(array_remove(array[
      case when x.missing_motifs > 0 then x.missing_motifs || ' remboursement(s) sans motif' end
    ], null)),
    'earned', case
      when not x.paid or x.missing_motifs > 0 then null
      else greatest(round(x.initial - x.cancelled_commission, 2), 0) end,
    'collected', public.order_collected_amount(o.id),
    'refunded', coalesce((select sum(amount) from refunds), 0),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'refundedAt', refunded_at, 'motif', motif, 'note', note, 'cancelledItems', items) order by refunded_at nulls last) from refunds), '[]'::jsonb)
  ) from x;
$$;

-- Commandes d'un partenaire (tests exclus), avec articles et commission.
create or replace function public.partner_orders(p_partner uuid, p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'orderNumber', o.order_number, 'createdAt', o.created_at, 'paidAt', o.paid_at,
      'customer', trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')),
      'payment', o.payment_status, 'validation', o.order_validation,
      'total', o.total_amount, 'partnerDiscount', o.partner_discount_amount,
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'product', i.product, 'size', i.size, 'total', i.total,
                  'commissionBase', i.partner_commission_base, 'commission', i.partner_commission_amount) order by i.created_at)
                from public.order_items i where i.order_id = o.id), '[]'::jsonb),
      'commission', public.partner_order_commission(o)
    ) order by coalesce(o.paid_at, o.created_at) desc), '[]'::jsonb)
  from public.orders o
  where o.partner_id = p_partner and not coalesce(o.is_test, false) and not coalesce(o.is_draft, false)
    and (p_from is null or (coalesce(o.paid_at, o.created_at) at time zone 'Europe/Zurich')::date >= p_from)
    and (p_to is null or (coalesce(o.paid_at, o.created_at) at time zone 'Europe/Zurich')::date <= p_to);
$$;

-- Indicateurs d'un partenaire sur une période (null = tout l'historique).
create or replace function public.partner_metrics(p_partner uuid, p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with ords as (select jsonb_array_elements(public.partner_orders(p_partner, p_from, p_to)) as j),
  c as (select j, j -> 'commission' as k from ords),
  pay as (select * from public.partner_payouts p where p.partner_id = p_partner and p.voided_at is null
          and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to))
  select jsonb_build_object(
    'ordersCount', (select count(*) from c),
    'paidOrdersCount', (select count(*) from c where (k ->> 'paid')::boolean),
    'collected', coalesce((select sum((k ->> 'collected')::numeric) from c), 0),
    'refunded', coalesce((select sum((k ->> 'refunded')::numeric) from c), 0),
    'revenueNet', coalesce((select sum((k ->> 'collected')::numeric - (k ->> 'refunded')::numeric) from c), 0),
    'commissionBase', coalesce((select sum(coalesce((k ->> 'base')::numeric, 0)) from c where (k ->> 'paid')::boolean), 0),
    'initial', coalesce((select sum(coalesce((k ->> 'initial')::numeric, 0)) from c where (k ->> 'paid')::boolean), 0),
    'earnedConfirmed', coalesce((select sum((k ->> 'earned')::numeric) from c where k ->> 'status' = 'earned' and (k ->> 'confirmed')::boolean), 0),
    'earnedUnconfirmed', coalesce((select sum((k ->> 'earned')::numeric) from c where k ->> 'status' = 'earned' and not (k ->> 'confirmed')::boolean), 0),
    'toCheckCount', (select count(*) from c where k ->> 'status' = 'to_check'),
    'toCheckInitial', coalesce((select sum(coalesce((k ->> 'initial')::numeric, 0)) from c where k ->> 'status' = 'to_check'), 0),
    'unpaidCount', (select count(*) from c where k ->> 'status' = 'unpaid'),
    'payouts', coalesce((select sum(amount) from pay), 0),
    'payoutsCount', (select count(*) from pay)
  );
$$;

-- ── Lectures admin ───────────────────────────────────────────────────────
create or replace function public.partner_conditions_status(p public.partners)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'commissionConfigured', p.commission_configured,
    'currentRateConfirmed', exists (select 1 from public.partner_condition_confirmations c
                                    where c.partner_id = p.id and c.revoked_at is null and c.commission_rate = p.commission_rate),
    'lastConfirmation', (select to_jsonb(c) from public.partner_condition_confirmations c where c.partner_id = p.id and c.revoked_at is null
                         order by c.confirmed_at desc limit 1)
  );
$$;

create or replace function public.admin_partner_list(p_from date, p_to date, p_search text, p_include_inactive boolean)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'active', p.active, 'referralToken', p.referral_token,
      'promoCodeReference', p.promo_code_reference, 'establishmentType', p.establishment_type,
      'customerDiscountRate', p.customer_discount_rate, 'commissionRate', p.commission_rate,
      'conditions', public.partner_conditions_status(p),
      'period', public.partner_metrics(p.id, p_from, p_to),
      'total', public.partner_metrics(p.id, null, null)
    ) order by p.active desc, lower(p.name)), '[]'::jsonb)
  from public.partners p
  where (coalesce(p_include_inactive, true) or p.active)
    and (coalesce(btrim(p_search), '') = '' or lower(p.name || ' ' || p.slug || ' ' || coalesce(p.promo_code_reference, '') || ' '
         || coalesce(p.contact_first_name, '') || ' ' || coalesce(p.contact_last_name, '')) like '%' || lower(btrim(p_search)) || '%');
$$;

create or replace function public.admin_partner_detail(p_id uuid, p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'partner', to_jsonb(p),
    'conditions', public.partner_conditions_status(p),
    'confirmations', coalesce((select jsonb_agg(to_jsonb(c) order by c.confirmed_at desc) from public.partner_condition_confirmations c where c.partner_id = p.id), '[]'::jsonb),
    'rateHistory', coalesce((select jsonb_agg(to_jsonb(h) order by h.effective_from desc, h.created_at desc) from public.partner_rate_history h where h.partner_id = p.id), '[]'::jsonb),
    'period', public.partner_metrics(p.id, p_from, p_to),
    'total', public.partner_metrics(p.id, null, null),
    'orders', public.partner_orders(p.id, p_from, p_to),
    'payouts', coalesce((select jsonb_agg(to_jsonb(x) - 'idempotency_key' order by x.paid_on desc, x.created_at desc) from public.partner_payouts x where x.partner_id = p.id), '[]'::jsonb),
    'hasHistory', exists (select 1 from public.orders o where o.partner_id = p.id) or exists (select 1 from public.partner_payouts x where x.partner_id = p.id)
  )
  from public.partners p where p.id = p_id;
$$;

-- ── Écritures ────────────────────────────────────────────────────────────
-- Créer / modifier un partenaire. Le slug (identifiant stable) et le jeton
-- du lien ne changent jamais une fois créés. Un changement de taux est
-- historisé (date d'effet = aujourd'hui : le paiement applique le taux en
-- vigueur ; les commandes passées gardent leur taux figé).
create or replace function public.partner_save(
  p_id uuid, p_name text, p_slug text, p_discount numeric, p_commission numeric, p_commission_configured boolean,
  p_active boolean, p_establishment text, p_address text, p_website text, p_contact_first text, p_contact_last text,
  p_contact_email text, p_contact_phone text, p_start date, p_promo_ref text, p_notion_page text, p_notes text, p_rate_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_old public.partners%rowtype;
  v_row public.partners%rowtype;
  v_commission numeric := case when coalesce(p_commission_configured, true) then p_commission else 0 end;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Nom du partenaire manquant' using errcode = 'P0001'; end if;
  if p_discount is null or p_discount < 0 or p_discount >= 1 then raise exception 'Remise client invalide (0 à 99 %%)' using errcode = 'P0001'; end if;
  if coalesce(p_commission_configured, true) and (p_commission is null or p_commission < 0 or p_commission >= 1) then
    raise exception 'Taux de commission invalide (0 à 99 %%) ou laisser « À configurer »' using errcode = 'P0001';
  end if;
  if p_establishment is not null and p_establishment not in ('hotel', 'bar', 'restaurant', 'company', 'other') then
    raise exception 'Type d''établissement inconnu' using errcode = 'P0001';
  end if;
  if p_id is null then
    if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Identifiant invalide (minuscules, chiffres et tirets)' using errcode = 'P0001'; end if;
    if exists (select 1 from public.partners where slug = p_slug) then raise exception 'Cet identifiant existe déjà' using errcode = 'P0001'; end if;
    insert into public.partners (name, slug, customer_discount_rate, commission_rate, commission_configured, active, establishment_type, address,
      website, contact_first_name, contact_last_name, contact_email, contact_phone, start_date, promo_code_reference, notion_page_id, notes, updated_by)
    values (btrim(p_name), p_slug, p_discount, v_commission, coalesce(p_commission_configured, true), coalesce(p_active, true), p_establishment,
      nullif(btrim(p_address), ''), nullif(btrim(p_website), ''), nullif(btrim(p_contact_first), ''), nullif(btrim(p_contact_last), ''),
      nullif(lower(btrim(p_contact_email)), ''), nullif(btrim(p_contact_phone), ''), p_start, nullif(btrim(p_promo_ref), ''),
      nullif(btrim(p_notion_page), ''), nullif(btrim(p_notes), ''), p_by)
    returning * into v_row;
    insert into public.partner_rate_history (partner_id, commission_rate, customer_discount_rate, commission_configured, effective_from, note, created_by)
    values (v_row.id, v_row.commission_rate, v_row.customer_discount_rate, v_row.commission_configured,
            (now() at time zone 'Europe/Zurich')::date, coalesce(nullif(btrim(p_rate_note), ''), 'Création'), p_by);
  else
    select * into v_old from public.partners where id = p_id for update;
    if not found then raise exception 'Partenaire introuvable' using errcode = 'P0002'; end if;
    if p_slug is not null and p_slug <> v_old.slug then raise exception 'L''identifiant d''un partenaire ne change pas' using errcode = 'P0001'; end if;
    update public.partners set name = btrim(p_name), customer_discount_rate = p_discount, commission_rate = v_commission,
           commission_configured = coalesce(p_commission_configured, true), active = coalesce(p_active, active),
           deactivated_at = case when coalesce(p_active, active) then null when active then now() else deactivated_at end,
           establishment_type = p_establishment, address = nullif(btrim(p_address), ''), website = nullif(btrim(p_website), ''),
           contact_first_name = nullif(btrim(p_contact_first), ''), contact_last_name = nullif(btrim(p_contact_last), ''),
           contact_email = nullif(lower(btrim(p_contact_email)), ''), contact_phone = nullif(btrim(p_contact_phone), ''),
           start_date = p_start, promo_code_reference = nullif(btrim(p_promo_ref), ''), notion_page_id = nullif(btrim(p_notion_page), ''),
           notes = nullif(btrim(p_notes), ''), updated_by = p_by, updated_at = now()
     where id = p_id returning * into v_row;
    if v_row.commission_rate is distinct from v_old.commission_rate or v_row.customer_discount_rate is distinct from v_old.customer_discount_rate
       or v_row.commission_configured is distinct from v_old.commission_configured then
      insert into public.partner_rate_history (partner_id, commission_rate, customer_discount_rate, commission_configured, effective_from, note, created_by)
      values (v_row.id, v_row.commission_rate, v_row.customer_discount_rate, v_row.commission_configured,
              (now() at time zone 'Europe/Zurich')::date, nullif(btrim(p_rate_note), ''), p_by);
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'slug', v_row.slug, 'referralToken', v_row.referral_token);
end;
$$;

-- Confirmer les conditions du partenaire pour son taux actuel : toutes les
-- règles appliquées par le site doivent être cochées comme « convenues ».
create or replace function public.partner_confirm_conditions(p_partner uuid, p_terms jsonb, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_p public.partners%rowtype; v_id uuid; k text;
begin
  select * into v_p from public.partners where id = p_partner;
  if not found then raise exception 'Partenaire introuvable' using errcode = 'P0002'; end if;
  if not v_p.commission_configured then raise exception 'Configurez d''abord le taux de commission' using errcode = 'P0001'; end if;
  foreach k in array array['rate', 'products', 'base', 'vat', 'earned'] loop
    if coalesce((p_terms ->> k)::boolean, false) is not true then
      raise exception 'Toutes les conditions doivent être confirmées (manque : %)', k using errcode = 'P0001';
    end if;
  end loop;
  if coalesce(btrim(p_terms ->> 'vatNote'), '') = '' then raise exception 'Précisez le traitement de la TVA convenu' using errcode = 'P0001'; end if;
  insert into public.partner_condition_confirmations (partner_id, commission_rate, terms, confirmed_by)
  values (p_partner, v_p.commission_rate, p_terms || jsonb_build_object('commissionRate', v_p.commission_rate, 'discountRate', v_p.customer_discount_rate), p_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.partner_revoke_conditions(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison' using errcode = 'P0001'; end if;
  update public.partner_condition_confirmations set revoked_at = now(), revoked_by = p_by, revoke_reason = btrim(p_reason)
   where id = p_id and revoked_at is null;
  if not found then raise exception 'Confirmation introuvable ou déjà révoquée' using errcode = 'P0002'; end if;
end;
$$;

-- Motif explicite d'un remboursement (P5). p_motif null = retirer le motif
-- (la commission repasse « À vérifier »).
create or replace function public.partner_set_refund_motif(p_refund uuid, p_motif text, p_item_ids uuid[], p_note text, p_by text)
returns void language plpgsql set search_path to '' as $$
declare v_r public.order_manual_refunds%rowtype; v_o public.orders%rowtype; i uuid;
begin
  select * into v_r from public.order_manual_refunds where id = p_refund;
  if not found then raise exception 'Remboursement introuvable' using errcode = 'P0002'; end if;
  select * into v_o from public.orders where id = v_r.order_id;
  if v_o.partner_id is null then raise exception 'Cette commande n''est attribuée à aucun partenaire' using errcode = 'P0001'; end if;
  delete from public.partner_refund_motifs where refund_id = p_refund;
  if p_motif is null then return; end if;
  if p_motif not in ('client_cancellation', 'commercial') then raise exception 'Motif inconnu' using errcode = 'P0001'; end if;
  if p_motif = 'client_cancellation' and coalesce(cardinality(p_item_ids), 0) = 0 then
    raise exception 'Indiquez le ou les gâteaux annulés par le client' using errcode = 'P0001';
  end if;
  insert into public.partner_refund_motifs (refund_id, order_id, motif, note, set_by) values (p_refund, v_r.order_id, p_motif, nullif(btrim(p_note), ''), p_by);
  if p_motif = 'client_cancellation' then
    foreach i in array p_item_ids loop
      if not exists (select 1 from public.order_items where id = i and order_id = v_r.order_id) then
        raise exception 'Article étranger à cette commande' using errcode = 'P0001';
      end if;
      insert into public.partner_refund_cancelled_items (refund_id, order_item_id) values (p_refund, i) on conflict do nothing;
    end loop;
  end if;
end;
$$;

-- Paiement de commission effectué hors du site (aucun virement déclenché).
create or replace function public.partner_payout_save(
  p_key text, p_partner uuid, p_paid_on date, p_amount numeric, p_period_start date, p_period_end date, p_reference text, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_row public.partner_payouts%rowtype;
begin
  if p_key is not null then
    select * into v_row from public.partner_payouts where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'replayed', true); end if;
  end if;
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Partenaire introuvable' using errcode = 'P0002'; end if;
  if p_paid_on is null then raise exception 'Date du paiement manquante' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  insert into public.partner_payouts (partner_id, amount, paid_on, period_start, period_end, note, reference, idempotency_key, created_by)
  values (p_partner, round(p_amount, 2), p_paid_on, coalesce(p_period_start, date_trunc('month', p_paid_on)::date), coalesce(p_period_end, p_paid_on),
          nullif(btrim(p_note), ''), nullif(btrim(p_reference), ''), p_key, p_by)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'replayed', false);
end;
$$;

create or replace function public.partner_payout_void(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de l''annulation' using errcode = 'P0001'; end if;
  update public.partner_payouts set voided_at = now(), voided_by = p_by, void_reason = btrim(p_reason) where id = p_id and voided_at is null;
  if not found then raise exception 'Paiement introuvable ou déjà annulé' using errcode = 'P0002'; end if;
end;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['partner_rate_history', 'partner_condition_confirmations', 'partner_refund_motifs', 'partner_refund_cancelled_items'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'partner_order_commission(public.orders)', 'partner_orders(uuid, date, date)', 'partner_metrics(uuid, date, date)',
    'partner_conditions_status(public.partners)', 'admin_partner_list(date, date, text, boolean)', 'admin_partner_detail(uuid, date, date)',
    'partner_save(uuid, text, text, numeric, numeric, boolean, boolean, text, text, text, text, text, text, text, date, text, text, text, text, text)',
    'partner_confirm_conditions(uuid, jsonb, text)', 'partner_revoke_conditions(uuid, text, text)',
    'partner_set_refund_motif(uuid, text, uuid[], text, text)',
    'partner_payout_save(text, uuid, date, numeric, date, date, text, text, text)', 'partner_payout_void(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
