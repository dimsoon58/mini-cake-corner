-- F35 (03.11.2026) — Codes promo influenceurs.
--
-- Un influenceur = une ligne de public.partners de type « influencer » :
--   * un code promo à taper dans le panier (LEA15…), propre à chacun, pour
--     savoir qui a amené quelles commandes (orders.partner_id, comme les liens) ;
--   * une remise client (ex. 15 %) sur le prix de base des produits, jamais sur
--     les suppléments, options, décos, bougies ou la livraison ;
--   * aucune commission (l'influenceur ne gagne rien) ;
--   * valable du … au … : en dehors de ces dates le code est refusé.
-- Le paiement (create-postfinance-payment) relit tout dans cette table, rien
-- n'est jamais pris du navigateur. Les commandes passées gardent leur remise
-- figée ; changer le % ou les dates ne vaut que pour les nouvelles commandes.
-- Jamais cumulable avec le rabais de bienvenue (règle existante des partenaires).
--
-- Additive, relançable. Les partenaires existants ne changent pas
-- (kind = 'partner', pas de code, pas de dates = toujours valables).

begin;

alter table public.partners add column if not exists kind text not null default 'partner';
alter table public.partners add column if not exists promo_code text;
alter table public.partners add column if not exists valid_from date;
alter table public.partners add column if not exists valid_until date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'partners_kind_check') then
    alter table public.partners add constraint partners_kind_check check (kind in ('partner', 'influencer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partners_promo_code_format_check') then
    alter table public.partners add constraint partners_promo_code_format_check
      check (promo_code is null or promo_code ~ '^[A-Z0-9]{3,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partners_validity_check') then
    alter table public.partners add constraint partners_validity_check
      check (valid_from is null or valid_until is null or valid_until >= valid_from);
  end if;
end $$;

create unique index if not exists partners_promo_code_key on public.partners (promo_code) where promo_code is not null;

comment on column public.partners.kind is 'partner = lien ?ref= (hôtels, bars…) ; influencer = code promo, sans commission (F35).';
comment on column public.partners.promo_code is 'Code promo à taper dans le panier (majuscules et chiffres). NULL = lien seulement.';
comment on column public.partners.valid_from is 'Premier jour de validité du code / lien (Europe/Zurich). NULL = sans limite.';
comment on column public.partners.valid_until is 'Dernier jour de validité du code / lien (Europe/Zurich). NULL = sans limite.';

-- ── Liste des influenceurs (Admin > Influenceurs) ────────────────────────
-- Commandes = commandes payées (tests et brouillons exclus, comme Partenaires).
create or replace function public.admin_influencer_list()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'slug', p.slug, 'code', p.promo_code, 'active', p.active,
      'referralToken', p.referral_token, 'discountRate', p.customer_discount_rate,
      'validFrom', p.valid_from, 'validUntil', p.valid_until, 'notes', p.notes, 'createdAt', p.created_at,
      'stats', (
        with o as (select j from jsonb_array_elements(public.partner_orders(p.id, null, null)) j
                   where (j -> 'commission' ->> 'paid')::boolean)
        select jsonb_build_object(
          'paidOrders', count(*),
          'revenueNet', coalesce(sum((j -> 'commission' ->> 'collected')::numeric - (j -> 'commission' ->> 'refunded')::numeric), 0),
          'discountGiven', coalesce(sum(coalesce((j ->> 'partnerDiscount')::numeric, 0)), 0))
        from o)
    ) order by p.active desc, coalesce(p.valid_until, '9999-12-31') desc, lower(p.name)), '[]'::jsonb)
  from public.partners p
  where p.kind = 'influencer';
$$;

-- ── Créer / modifier un influenceur ──────────────────────────────────────
-- Commission toujours 0. Le slug (identifiant stable, « inf-<code> ») et le
-- jeton du lien ne changent jamais ; le code, le %, les dates, oui.
-- Un changement de % est historisé comme pour les partenaires.
create or replace function public.influencer_save(
  p_id uuid, p_name text, p_code text, p_discount numeric, p_from date, p_until date, p_active boolean, p_notes text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_old public.partners%rowtype;
  v_row public.partners%rowtype;
  v_slug text;
  n int := 1;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Nom de l''influenceur manquant' using errcode = 'P0001'; end if;
  if v_code !~ '^[A-Z0-9]{3,20}$' then raise exception 'Code promo invalide : 3 à 20 lettres ou chiffres, sans espace' using errcode = 'P0001'; end if;
  if p_discount is null or p_discount <= 0 or p_discount >= 1 then raise exception 'Remise invalide (1 à 99 %%)' using errcode = 'P0001'; end if;
  if p_from is null or p_until is null then raise exception 'Dates de validité manquantes' using errcode = 'P0001'; end if;
  if p_until < p_from then raise exception 'La date de fin est avant la date de début' using errcode = 'P0001'; end if;
  if exists (select 1 from public.partners where promo_code = v_code and id is distinct from p_id) then
    raise exception 'Ce code promo est déjà utilisé' using errcode = 'P0001';
  end if;

  if p_id is null then
    v_slug := 'inf-' || lower(v_code);
    while exists (select 1 from public.partners where slug = v_slug) loop
      n := n + 1;
      v_slug := 'inf-' || lower(v_code) || '-' || n;
    end loop;
    insert into public.partners (name, slug, kind, promo_code, customer_discount_rate, commission_rate, commission_configured,
      active, valid_from, valid_until, start_date, notes, updated_by)
    values (btrim(p_name), v_slug, 'influencer', v_code, p_discount, 0, true,
      coalesce(p_active, true), p_from, p_until, p_from, nullif(btrim(p_notes), ''), p_by)
    returning * into v_row;
    insert into public.partner_rate_history (partner_id, commission_rate, customer_discount_rate, commission_configured, effective_from, note, created_by)
    values (v_row.id, 0, v_row.customer_discount_rate, true, (now() at time zone 'Europe/Zurich')::date, 'Création (influenceur)', p_by);
  else
    select * into v_old from public.partners where id = p_id for update;
    if not found or v_old.kind <> 'influencer' then raise exception 'Influenceur introuvable' using errcode = 'P0002'; end if;
    update public.partners set name = btrim(p_name), promo_code = v_code, customer_discount_rate = p_discount,
           valid_from = p_from, valid_until = p_until, active = coalesce(p_active, active),
           deactivated_at = case when coalesce(p_active, active) then null when active then now() else deactivated_at end,
           notes = nullif(btrim(p_notes), ''), updated_by = p_by, updated_at = now()
     where id = p_id returning * into v_row;
    if v_row.customer_discount_rate is distinct from v_old.customer_discount_rate then
      insert into public.partner_rate_history (partner_id, commission_rate, customer_discount_rate, commission_configured, effective_from, note, created_by)
      values (v_row.id, 0, v_row.customer_discount_rate, true, (now() at time zone 'Europe/Zurich')::date, 'Changement de remise (influenceur)', p_by);
    end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'slug', v_row.slug, 'code', v_row.promo_code, 'referralToken', v_row.referral_token);
end;
$$;


-- ── Workshops : remboursement d'une place après un code promo ────────────
-- Les codes influenceurs s'appliquent aussi aux workshops (prix des places).
-- Une annulation de places rembourse alors le prix payé, remise déduite.
-- Garde-fou : la fonction en production doit être exactement celle du dépôt
-- (20260912100300) ; sinon la migration s'arrête et RIEN n'est appliqué.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'cancel_workshop_seats_atomic';
  if v_def is null then
    raise exception 'F35 : cancel_workshop_seats_atomic introuvable — migration arrêtée, rien n''est appliqué';
  end if;
  if position('v_cash_captured := round(v_res.unit_price * v_res.purchased_seats - v_res.reward_amount_used, 2);' in v_def) = 0
     and position('partner_discount_amount' in v_def) = 0 then
    raise exception 'F35 : cancel_workshop_seats_atomic en production diffère du dépôt — migration arrêtée, rien n''est appliqué';
  end if;
end $$;

create or replace function public.cancel_workshop_seats_atomic(
  p_reference          text,
  p_reservation_id     uuid,
  p_seats_to_cancel    integer,
  p_idempotency_key    text,
  p_within_free_window boolean
)
returns public.workshop_cancellation_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res              public.workshop_reservations%rowtype;
  v_order            public.orders%rowtype;
  v_log              public.workshop_cancellation_log%rowtype;
  v_active           integer;
  v_status           text;
  v_cancelled_after  integer;
  v_cash_captured    numeric(12,2);
  v_cash_already     numeric(12,2);
  v_reward_already   numeric(12,2);
  v_cash_target      numeric(12,2);
  v_reward_target    numeric(12,2);
  v_cash_delta       numeric(12,2);
  v_reward_delta     numeric(12,2);
  v_refund_status    text;
begin
  if p_seats_to_cancel is null or p_seats_to_cancel <= 0 then
    raise exception 'seats_to_cancel must be a positive integer' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;

  -- ── Lock the reservation FIRST — every read/write below (including the
  -- financial calculation) happens under this ONE lock, held for the whole
  -- transaction. A concurrent call for the same reservation blocks here
  -- until this transaction commits or rolls back.
  select wr.* into v_res
  from public.workshop_reservations wr
  where (p_reservation_id is not null and wr.id = p_reservation_id)
     or (p_reference is not null and wr.workshop_reference = p_reference)
  for update;
  if not found then
    raise exception 'Workshop reservation not found' using errcode = 'P0002';
  end if;

  -- Idempotency: this exact cancel already applied -> return the existing
  -- log untouched (whatever it was originally computed as — never
  -- recomputed on a retry).
  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.reservation_id = v_res.id
    and l.idempotency_key = p_idempotency_key;
  if found then
    return v_log;
  end if;

  if v_res.status not in ('confirmed', 'partially_cancelled') then
    raise exception 'Reservation % is % — partial cancellation needs confirmed/partially_cancelled',
      v_res.workshop_reference, v_res.status using errcode = 'P0005';
  end if;
  select o.* into v_order from public.orders o where o.id = v_res.order_id;
  if not found
     or not (v_order.order_validation = 'approved'
             or v_order.workshop_confirmed_at is not null) then
    raise exception 'Order for reservation % is not confirmed', v_res.workshop_reference using errcode = 'P0006';
  end if;

  v_active := v_res.purchased_seats - v_res.cancelled_seats;
  if p_seats_to_cancel > v_active then
    raise exception 'Cannot cancel % seats: only % active', p_seats_to_cancel, v_active
      using errcode = 'P0003';
  end if;

  v_status := case
    when (v_active - p_seats_to_cancel) = 0 then 'cancelled'
    else 'partially_cancelled'
  end;
  v_cancelled_after := v_res.cancelled_seats + p_seats_to_cancel;

  -- ── Financial calculation — SAME lock, SAME transaction ────────────────
  -- "Already logged" can only reflect prior cancellations of THIS
  -- reservation that already committed: every insert into this log for this
  -- reservation_id happens inside this same locked section (in EITHER this
  -- function or the legacy cancel_workshop_seats — see the note below), so
  -- a second concurrent caller blocked above on `for update` is guaranteed
  -- to see every row a first caller committed before it, and none that it
  -- didn't.
  select coalesce(sum(refund_amount_requested), 0), coalesce(sum(reward_amount_due), 0)
    into v_cash_already, v_reward_already
  from public.workshop_cancellation_log
  where reservation_id = v_res.id;

  -- The only mechanism that can ever reduce what was actually captured for
  -- a workshop line below unit_price * purchased_seats is the reward
  -- deduction (verified directly in create-postfinance-payment: the welcome
  -- discount explicitly skips every workshop item and is never applied to
  -- one; the express surcharge is its own separate PostFinance line, never
  -- modifies a product line, and is computed excluding workshops entirely;
  -- there is no other discount/promo mechanism in that function). So the
  -- net cash actually captured for this reservation is exactly
  -- unit_price * purchased_seats - reward_amount_used.
  -- F35 : moins la remise d'un code promo sur ces places (order_items.
  -- partner_discount_amount de la ligne workshop) — on ne rembourse jamais
  -- plus que ce que le client a payé.
  v_cash_captured := round(v_res.unit_price * v_res.purchased_seats - v_res.reward_amount_used
    - coalesce((select oi.partner_discount_amount from public.order_items oi where oi.id = v_res.order_item_id), 0), 2);

  if p_within_free_window then
    v_cash_target   := round(v_cash_captured * v_cancelled_after / v_res.purchased_seats, 2);
    v_reward_target := round(v_res.reward_amount_used * v_cancelled_after / v_res.purchased_seats, 2);
  else
    -- Outside the free-cancellation window: this call contributes NOTHING
    -- new (targets frozen at whatever was already logged) — no refund, no
    -- reward restoration for the newly-cancelled seats, but never claws
    -- back what an EARLIER, in-window cancellation of the same reservation
    -- already logged.
    v_cash_target   := v_cash_already;
    v_reward_target := v_reward_already;
  end if;

  v_cash_delta   := greatest(round(v_cash_target - v_cash_already, 2), 0);
  v_reward_delta := greatest(round(v_reward_target - v_reward_already, 2), 0);

  v_refund_status := case
    when not p_within_free_window then 'outside_window'
    when v_cash_delta > 0 then 'pending'
    else 'non_required'
  end;

  update public.workshop_reservations wr
  set cancelled_seats = v_cancelled_after,
      status          = v_status,
      updated_at      = now()
  where wr.id = v_res.id;

  insert into public.workshop_cancellation_log (
    reservation_id, idempotency_key, seats_cancelled,
    refund_amount_requested, refund_amount_completed, refund_status,
    reward_amount_due, reward_amount_restored
  ) values (
    v_res.id, p_idempotency_key, p_seats_to_cancel,
    v_cash_delta, 0, v_refund_status,
    v_reward_delta, 0
  )
  returning * into v_log;

  return v_log;
end;
$$;

revoke execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean) to service_role;

-- ── Accès : service_role uniquement (comme F14) ──────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'admin_influencer_list()',
    'influencer_save(uuid, text, text, numeric, date, date, boolean, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
