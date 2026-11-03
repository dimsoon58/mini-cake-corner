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
