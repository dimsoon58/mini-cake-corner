-- F8 — Base clients commune (lot C, « Clients »).
--
-- Décisions validées le 01.10.2026 :
--   - UNE base clients (`customers`) pour les clients avec ou sans compte.
--     Les comptes (`profiles`) restent tels quels : connexion, cagnotte,
--     offre de bienvenue — rien de leur calcul n'est modifié. Un client avec
--     compte a simplement `customers.profile_id`.
--   - Chaque commande (site, manuelle, workshop) pointe vers son client :
--     `orders.customer_ref_id`. La commande garde SES coordonnées (copie
--     historique, factures) : modifier un client ne réécrit jamais une
--     commande.
--   - Rapprochement automatique : email normalisé, SEULEMENT si les
--     informations sont cohérentes. Contradiction (prénom ET nom différents)
--     → nouveau client + alerte, jamais de fusion. Téléphone identique chez
--     un autre client → alerte. Le nom seul ne rapproche jamais.
--   - Fusion uniquement manuelle (merge_customers), avec trace ; rien n'est
--     supprimé.
--   - Commandes de test : rattachées comme les autres, exclues des
--     statistiques (orders.is_test).
--   - Make / Notion : rien n'est modifié. `notion_page_id` est préparé pour
--     une reprise ultérieure (aucun import ici).
--
-- Rattachement automatique (trigger sur orders) : commandes manuelles dès
-- l'enregistrement ; commandes du site dès qu'elles sont encaissées (un panier
-- abandonné ne crée aucun client). Une erreur de rattachement est notée dans
-- customer_alerts et ne bloque JAMAIS une commande ni un paiement.
--
-- Additive, relançable. Nécessite F1–F7. Service_role uniquement.

begin;

-- ── Normalisation ────────────────────────────────────────────────────────
create or replace function public.norm_email(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(lower(btrim(coalesce(p, ''))), '');
$$;

-- Téléphone : chiffres seulement, préfixe international. Suisse par défaut
-- pour un numéro national à 10 chiffres commençant par 0.
create or replace function public.norm_phone(p text)
returns text language plpgsql immutable set search_path to '' as $$
declare s text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
begin
  if s = '' or s = '+' then return null; end if;
  s := case when left(s, 1) = '+' then '+' || replace(substr(s, 2), '+', '') else replace(s, '+', '') end;
  if s like '00%' then s := '+' || substr(s, 3);
  elsif s like '0%' and length(s) = 10 then s := '+41' || substr(s, 2);
  end if;
  return s;
end;
$$;

create or replace function public.norm_name(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(regexp_replace(translate(lower(btrim(coalesce(p, ''))),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]+', ' ', 'g'), '');
$$;

-- ── Tables ───────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  first_name     text,
  last_name      text,
  email          text,
  phone          text,
  company        text,
  address        text,
  notes          text,
  email_norm     text generated always as (public.norm_email(email)) stored,
  phone_norm     text generated always as (public.norm_phone(phone)) stored,
  name_norm      text generated always as (public.norm_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored,
  profile_id     uuid references public.profiles(id) on delete set null,
  merged_into    uuid references public.customers(id),
  merged_at      timestamptz,
  merged_by      text,
  notion_page_id text,
  source         text not null default 'admin' check (source in ('admin', 'order', 'profile', 'notion')),
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists customers_profile_uidx on public.customers (profile_id) where profile_id is not null;
create unique index if not exists customers_notion_uidx on public.customers (notion_page_id) where notion_page_id is not null;
create index if not exists customers_email_norm_idx on public.customers (email_norm) where merged_into is null;
create index if not exists customers_phone_norm_idx on public.customers (phone_norm) where merged_into is null;
create index if not exists customers_name_norm_idx on public.customers (name_norm);

comment on table public.customers is
  'Base clients unique (avec ou sans compte). profiles reste le compte (cagnotte, bienvenue). Les commandes gardent leurs propres coordonnées historiques.';

alter table public.orders add column if not exists customer_ref_id uuid references public.customers(id);
create index if not exists orders_customer_ref_idx on public.orders (customer_ref_id);

create table if not exists public.customer_alerts (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in ('contradiction', 'phone_shared', 'profile_contact_diff', 'link_error')),
  customer_id       uuid references public.customers(id),
  other_customer_id uuid references public.customers(id),
  order_id          uuid references public.orders(id),
  detail            text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       text
);
create unique index if not exists customer_alerts_once_uidx on public.customer_alerts
  (kind, coalesce(customer_id::text, ''), coalesce(other_customer_id::text, ''), coalesce(order_id::text, ''))
  where resolved_at is null;

create table if not exists public.customer_events (
  id          bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  kind        text not null check (kind in ('created', 'updated', 'merged_into', 'absorbed', 'order_relinked')),
  detail      jsonb,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists customer_events_customer_idx on public.customer_events (customer_id, created_at);

-- ── Cohérence d'un rapprochement par email ───────────────────────────────
-- Contradiction = prénom ET nom renseignés des deux côtés, et tous deux
-- différents (après normalisation). Un seul champ différent (surnom, nom
-- d'usage) reste cohérent ; un champ manquant ne contredit rien.
create or replace function public.customer_contradicts(p_customer public.customers, p_first text, p_last text)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce(
    public.norm_name(p_customer.first_name) is not null and public.norm_name(p_first) is not null
    and public.norm_name(p_customer.last_name) is not null and public.norm_name(p_last) is not null
    and public.norm_name(p_customer.first_name) <> public.norm_name(p_first)
    and public.norm_name(p_customer.last_name) <> public.norm_name(p_last), false);
$$;

create or replace function public.customer_alert(p_kind text, p_customer uuid, p_other uuid, p_order uuid, p_detail text)
returns void language sql set search_path to '' as $$
  insert into public.customer_alerts (kind, customer_id, other_customer_id, order_id, detail)
  values (p_kind, p_customer, p_other, p_order, p_detail)
  on conflict do nothing;
$$;

-- Téléphone déjà utilisé par un AUTRE client actif → alerte (jamais de fusion).
create or replace function public.customer_check_phone(p_customer uuid)
returns void language plpgsql set search_path to '' as $$
declare v_phone text; v_other uuid;
begin
  select phone_norm into v_phone from public.customers where id = p_customer;
  if v_phone is null then return; end if;
  for v_other in
    select id from public.customers
    where phone_norm = v_phone and id <> p_customer and merged_into is null
  loop
    perform public.customer_alert('phone_shared', least(p_customer, v_other), greatest(p_customer, v_other), null,
      'Même numéro de téléphone sur deux fiches clients');
  end loop;
end;
$$;

-- Compléter UNIQUEMENT les champs vides d'une fiche (jamais écraser une
-- valeur existante). Retourne true si quelque chose a été complété.
create or replace function public.customer_fill_blanks(p_customer uuid, p_first text, p_last text, p_email text, p_phone text)
returns boolean language plpgsql set search_path to '' as $$
declare v_n int;
begin
  update public.customers
     set first_name = coalesce(nullif(btrim(first_name), ''), nullif(btrim(p_first), '')),
         last_name  = coalesce(nullif(btrim(last_name), ''), nullif(btrim(p_last), '')),
         email      = coalesce(nullif(btrim(email), ''), nullif(btrim(p_email), '')),
         phone      = coalesce(nullif(btrim(phone), ''), nullif(btrim(p_phone), '')),
         updated_at = now()
   where id = p_customer and merged_into is null
     and ((nullif(btrim(first_name), '') is null and nullif(btrim(p_first), '') is not null)
       or (nullif(btrim(last_name), '') is null and nullif(btrim(p_last), '') is not null)
       or (nullif(btrim(email), '') is null and nullif(btrim(p_email), '') is not null)
       or (nullif(btrim(phone), '') is null and nullif(btrim(p_phone), '') is not null));
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.customer_check_phone(p_customer); end if;
  return v_n > 0;
end;
$$;

-- ── Client d'un compte ───────────────────────────────────────────────────
create or replace function public.ensure_profile_customer(p_profile_id uuid)
returns uuid language plpgsql set search_path to '' as $$
declare
  v_profile public.profiles%rowtype;
  v_cust public.customers%rowtype;
  v_id uuid;
begin
  select id into v_id from public.customers where profile_id = p_profile_id;
  if found then
    -- Un client fusionné renvoie à sa fiche de destination.
    while exists (select 1 from public.customers where id = v_id and merged_into is not null) loop
      select merged_into into v_id from public.customers where id = v_id;
    end loop;
    return v_id;
  end if;

  select * into v_profile from public.profiles where id = p_profile_id;
  if not found then return null; end if;

  -- Fiche existante (sans compte) avec le même email et des informations cohérentes.
  select c.* into v_cust from public.customers c
  where c.email_norm = public.norm_email(v_profile.email) and c.merged_into is null and c.profile_id is null
    and not public.customer_contradicts(c, v_profile.first_name, v_profile.last_name)
  order by c.created_at limit 1;
  if found then
    update public.customers set profile_id = p_profile_id, updated_at = now() where id = v_cust.id;
    return v_cust.id;
  end if;

  insert into public.customers (first_name, last_name, email, phone, profile_id, source, created_by)
  values (v_profile.first_name, v_profile.last_name, v_profile.email, v_profile.phone, p_profile_id, 'profile', 'system')
  returning id into v_id;
  insert into public.customer_events (customer_id, kind, detail, created_by)
  values (v_id, 'created', jsonb_build_object('from', 'profile', 'profile_id', p_profile_id), 'system');

  -- Même email sur une fiche aux informations contradictoires → alerte.
  select c.* into v_cust from public.customers c
  where c.email_norm = public.norm_email(v_profile.email) and c.merged_into is null and c.id <> v_id
  order by c.created_at limit 1;
  if found then
    perform public.customer_alert('contradiction', v_id, v_cust.id, null,
      'Même email, prénom et nom différents : fiches gardées séparées');
  end if;
  perform public.customer_check_phone(v_id);
  return v_id;
end;
$$;

-- ── Rattachement d'une commande ──────────────────────────────────────────
create or replace function public.link_order_customer(p_order_id uuid)
returns uuid language plpgsql set search_path to '' as $$
declare
  v_order public.orders%rowtype;
  v_cust public.customers%rowtype;
  v_id uuid;
  v_first_candidate uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then return null; end if;
  if v_order.customer_ref_id is not null then return v_order.customer_ref_id; end if;

  if v_order.customer_id is not null then
    v_id := public.ensure_profile_customer(v_order.customer_id);
  end if;

  if v_id is null and public.norm_email(v_order.email) is not null then
    for v_cust in
      select c.* from public.customers c
      where c.email_norm = public.norm_email(v_order.email) and c.merged_into is null
      order by c.created_at
    loop
      v_first_candidate := coalesce(v_first_candidate, v_cust.id);
      if not public.customer_contradicts(v_cust, v_order.first_name, v_order.last_name) then
        v_id := v_cust.id;
        exit;
      end if;
    end loop;
  end if;

  if v_id is null then
    insert into public.customers (first_name, last_name, email, phone, company, address, source, created_by)
    values (v_order.first_name, v_order.last_name, v_order.email, v_order.phone, v_order.customer_company,
            v_order.delivery_address, 'order', 'system')
    returning id into v_id;
    insert into public.customer_events (customer_id, kind, detail, created_by)
    values (v_id, 'created', jsonb_build_object('from', 'order', 'order_id', p_order_id, 'order_number', v_order.order_number), 'system');
    if v_first_candidate is not null then
      perform public.customer_alert('contradiction', v_id, v_first_candidate, p_order_id,
        'Même email, prénom et nom différents : nouvelle fiche créée, à vérifier');
    end if;
    perform public.customer_check_phone(v_id);
  end if;

  -- Fiche existante : compléter ses champs vides avec ceux de la commande.
  perform public.customer_fill_blanks(v_id, v_order.first_name, v_order.last_name, v_order.email, v_order.phone);
  update public.orders set customer_ref_id = v_id where id = p_order_id;
  return v_id;
end;
$$;

-- Une commande est rattachée quand elle est « enregistrée » : commande
-- manuelle (dès sa création), commande du site encaissée.
create or replace function public.order_is_customer_linkable(p public.orders)
returns boolean language sql immutable set search_path to '' as $$
  select coalesce(p.created_via = 'admin', false) or p.payment_status::text in ('paid', 'refunded') or p.paid_at is not null;
$$;

create or replace function public.trg_orders_link_customer()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.customer_ref_id is null and public.order_is_customer_linkable(new) then
    begin
      perform public.link_order_customer(new.id);
    exception when others then
      insert into public.customer_alerts (kind, order_id, detail) values ('link_error', new.id, sqlerrm)
      on conflict do nothing;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_orders_link_customer on public.orders;
create trigger trg_orders_link_customer
  after insert or update of payment_status, paid_at, customer_id, created_via on public.orders
  for each row execute function public.trg_orders_link_customer();

-- Nouveau compte → sa fiche client ; coordonnées du compte modifiées →
-- alerte (pas de mise à jour automatique de la fiche).
create or replace function public.trg_profiles_customer()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_cust public.customers%rowtype;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.ensure_profile_customer(new.id);
    else
      select * into v_cust from public.customers where profile_id = new.id and merged_into is null;
      if found then
        perform public.customer_fill_blanks(v_cust.id, new.first_name, new.last_name, new.email, new.phone);
        select * into v_cust from public.customers where id = v_cust.id;
      end if;
      -- Écart seulement entre deux valeurs renseignées.
      if found and (
           (public.norm_email(new.email) is not null and v_cust.email_norm is not null and public.norm_email(new.email) <> v_cust.email_norm)
        or (public.norm_phone(new.phone) is not null and v_cust.phone_norm is not null and public.norm_phone(new.phone) <> v_cust.phone_norm)
        or (public.norm_name(new.first_name) is not null and public.norm_name(v_cust.first_name) is not null and public.norm_name(new.first_name) <> public.norm_name(v_cust.first_name))
        or (public.norm_name(new.last_name) is not null and public.norm_name(v_cust.last_name) is not null and public.norm_name(new.last_name) <> public.norm_name(v_cust.last_name))) then
        perform public.customer_alert('profile_contact_diff', v_cust.id, null, null,
          'Coordonnées du compte client différentes de la fiche : à valider');
      end if;
    end if;
  exception when others then
    insert into public.customer_alerts (kind, detail) values ('link_error', 'profil ' || new.id || ' : ' || sqlerrm)
    on conflict do nothing;
  end;
  return null;
end;
$$;

drop trigger if exists trg_profiles_customer on public.profiles;
create trigger trg_profiles_customer
  after insert or update of email, first_name, last_name, phone on public.profiles
  for each row execute function public.trg_profiles_customer();

-- ── Statistiques (registres des lots 1–3, tests exclus) ──────────────────
create or replace function public.customer_stats(p_customer uuid)
returns table (orders_count bigint, paid_count bigint, collected numeric, refunded numeric, net numeric,
               first_order_at timestamptz, last_order_at timestamptz, test_orders bigint)
language sql stable set search_path to '' as $$
  with o as (
    select o.id, o.created_at, o.is_test, public.order_collected_amount(o.id) as collected
    from public.orders o where o.customer_ref_id = p_customer
  ),
  real as (select * from o where not is_test),
  r as (
    select coalesce(sum(m.amount), 0) as refunded
    from public.order_manual_refunds m join real on real.id = m.order_id
    where m.status = 'counted'
  )
  select
    (select count(*) from real),
    (select count(*) from real where collected > 0),
    (select coalesce(round(sum(collected), 2), 0) from real),
    (select round(refunded, 2) from r),
    (select coalesce(round(sum(collected), 2), 0) from real) - (select round(refunded, 2) from r),
    (select min(created_at) from real),
    (select max(created_at) from real),
    (select count(*) from o where is_test);
$$;

-- ── Lecture admin : liste ────────────────────────────────────────────────
create or replace function public.admin_customer_list(
  p_search text default null, p_sort text default 'last_order', p_desc boolean default true,
  p_page int default 1, p_size int default 25, p_include_tests boolean default false)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_size int := least(greatest(coalesce(p_size, 25), 1), 100);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_result jsonb;
begin
  if p_sort not in ('name', 'last_order', 'orders', 'net', 'created') then
    raise exception 'Tri inconnu' using errcode = 'P0001';
  end if;
  with base as (
    select c.*, s.*
    from public.customers c
    cross join lateral public.customer_stats(c.id) s
    where c.merged_into is null
      and (p_include_tests or not (s.orders_count = 0 and s.test_orders > 0))
      and (v_q is null
           or c.name_norm like '%' || public.norm_name(v_q) || '%'
           or c.email_norm like '%' || lower(v_q) || '%'
           or (length(v_digits) >= 4 and regexp_replace(coalesce(c.phone_norm, ''), '[^0-9]', '', 'g') like '%' || ltrim(v_digits, '0') || '%'))
  ),
  sorted as (
    select b.*, count(*) over () as total_count,
      row_number() over (order by
        case when p_sort = 'name' and not p_desc then coalesce(b.name_norm, '~') end asc,
        case when p_sort = 'name' and p_desc then coalesce(b.name_norm, '') end desc,
        case when p_sort = 'last_order' and not p_desc then b.last_order_at end asc nulls last,
        case when p_sort = 'last_order' and p_desc then b.last_order_at end desc nulls last,
        case when p_sort = 'orders' and not p_desc then b.orders_count end asc,
        case when p_sort = 'orders' and p_desc then b.orders_count end desc,
        case when p_sort = 'net' and not p_desc then b.net end asc,
        case when p_sort = 'net' and p_desc then b.net end desc,
        case when p_sort = 'created' and not p_desc then b.created_at end asc,
        case when p_sort = 'created' and p_desc then b.created_at end desc,
        b.created_at desc) as rn
    from base b
  )
  select jsonb_build_object(
    'total', coalesce(max(total_count), 0),
    'page', v_page, 'size', v_size,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'firstName', first_name, 'lastName', last_name, 'email', email, 'phone', phone,
      'company', company, 'hasAccount', profile_id is not null,
      'ordersCount', orders_count, 'paidCount', paid_count, 'net', net, 'lastOrderAt', last_order_at,
      'openAlerts', (select count(*) from public.customer_alerts a where a.resolved_at is null and (a.customer_id = sorted.id or a.other_customer_id = sorted.id))
    ) order by rn) filter (where rn > (v_page - 1) * v_size and rn <= v_page * v_size), '[]'::jsonb)
  ) into v_result from sorted;
  return v_result;
end;
$$;

-- ── Lecture admin : fiche ────────────────────────────────────────────────
create or replace function public.admin_customer_detail(p_customer uuid)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id, 'firstName', c.first_name, 'lastName', c.last_name, 'email', c.email, 'phone', c.phone,
      'company', c.company, 'address', c.address, 'notes', c.notes, 'source', c.source,
      'createdAt', c.created_at, 'updatedAt', c.updated_at, 'mergedInto', c.merged_into, 'notionPageId', c.notion_page_id),
    'stats', (select to_jsonb(s) from public.customer_stats(c.id) s),
    'account', (select jsonb_build_object(
        'profileId', p.id, 'email', p.email, 'rewardBalance', p.reward_balance,
        'welcomeAvailable', p.welcome_discount_available, 'welcomeUsedAt', p.welcome_discount_used_at,
        'welcomeExpiresAt', p.welcome_discount_expires_at, 'newsletter', p.newsletter_subscription,
        'createdAt', p.created_at)
      from public.profiles p where p.id = c.profile_id),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'orderNumber', o.order_number, 'createdAt', o.created_at, 'paidAt', o.paid_at,
        'source', case when o.fulfillment_type = 'workshop_only' then 'workshop'
                       else public.order_origin(o.order_number, o.order_source) end,
        'fulfillmentType', o.fulfillment_type, 'validation', o.order_validation, 'payment', o.payment_status,
        'physical', o.physical_validation, 'isTest', o.is_test, 'isDraft', o.is_draft,
        'total', o.total_amount, 'collected', public.order_collected_amount(o.id),
        'refunded', (select coalesce(sum(m.amount), 0) from public.order_manual_refunds m where m.order_id = o.id and m.status = 'counted'),
        'contact', jsonb_build_object('firstName', o.first_name, 'lastName', o.last_name, 'email', o.email, 'phone', o.phone),
        'dates', (select coalesce(jsonb_agg(distinct d), '[]'::jsonb) from (
            select f.pickup_delivery_date as d from public.order_fulfillments f where f.order_id = o.id
            union select oi.workshop_date from public.order_items oi where oi.order_id = o.id and oi.workshop_date is not null
            union select o.pickup_delivery_date where o.pickup_delivery_date is not null) x where d is not null),
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'product', oi.product, 'size', oi.size, 'shape', oi.shape, 'flavors', oi.flavors, 'quantity', oi.quantity,
            'workshopType', oi.workshop_type, 'participants', oi.workshop_participants, 'productionStatus', oi.production_status)
            order by oi.created_at), '[]'::jsonb) from public.order_items oi where oi.order_id = o.id)
      ) order by o.created_at desc) from public.orders o where o.customer_ref_id = c.id), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'detail', a.detail, 'createdAt', a.created_at, 'orderId', a.order_id,
        'otherCustomerId', case when a.customer_id = c.id then a.other_customer_id else a.customer_id end)
        order by a.created_at desc)
      from public.customer_alerts a where a.resolved_at is null and (a.customer_id = c.id or a.other_customer_id = c.id)), '[]'::jsonb),
    'possibleDuplicates', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'firstName', d.first_name, 'lastName', d.last_name, 'email', d.email, 'phone', d.phone,
        'hasAccount', d.profile_id is not null,
        'reasons', array_remove(array[
          case when d.email_norm = c.email_norm then 'email' end,
          case when d.phone_norm = c.phone_norm then 'phone' end,
          case when d.name_norm = c.name_norm then 'name' end], null)))
      from public.customers d
      where d.id <> c.id and d.merged_into is null
        and (d.email_norm = c.email_norm or d.phone_norm = c.phone_norm or d.name_norm = c.name_norm)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'by', e.created_by, 'at', e.created_at)
        order by e.created_at desc) from public.customer_events e where e.customer_id = c.id), '[]'::jsonb)
  )
  from public.customers c where c.id = p_customer;
$$;

-- ── Écritures admin ──────────────────────────────────────────────────────
-- Créer / modifier une fiche. Ne touche jamais aux commandes. Un email déjà
-- utilisé par une autre fiche active est refusé (P0004, message avec l'id),
-- sauf p_allow_same_email (homonymie confirmée par l'admin).
create or replace function public.admin_customer_save(
  p_id uuid, p_first text, p_last text, p_email text, p_phone text, p_company text,
  p_address text, p_notes text, p_by text, p_allow_same_email boolean default false)
returns uuid language plpgsql set search_path to '' as $$
declare
  v_id uuid := p_id;
  v_dup uuid;
  v_before jsonb;
begin
  if nullif(btrim(coalesce(p_first, '')), '') is null and nullif(btrim(coalesce(p_last, '')), '') is null
     and public.norm_email(p_email) is null then
    raise exception 'Indiquez au moins un nom ou un email' using errcode = 'P0001';
  end if;
  if public.norm_email(p_email) is not null and public.norm_email(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email invalide' using errcode = 'P0001';
  end if;
  if public.norm_email(p_email) is not null and not p_allow_same_email then
    select id into v_dup from public.customers
    where email_norm = public.norm_email(p_email) and merged_into is null and id is distinct from p_id
    order by created_at limit 1;
    if found then
      raise exception 'Une autre fiche utilise déjà cet email (%)', v_dup using errcode = 'P0004';
    end if;
  end if;

  if v_id is null then
    insert into public.customers (first_name, last_name, email, phone, company, address, notes, source, created_by)
    values (nullif(btrim(p_first), ''), nullif(btrim(p_last), ''), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''),
            nullif(btrim(p_company), ''), nullif(btrim(p_address), ''), nullif(btrim(p_notes), ''), 'admin', p_by)
    returning id into v_id;
    insert into public.customer_events (customer_id, kind, detail, created_by) values (v_id, 'created', jsonb_build_object('from', 'admin'), p_by);
  else
    select to_jsonb(c) - 'email_norm' - 'phone_norm' - 'name_norm' into v_before from public.customers c where c.id = v_id and c.merged_into is null;
    if v_before is null then raise exception 'Client introuvable ou fusionné' using errcode = 'P0002'; end if;
    update public.customers
       set first_name = nullif(btrim(p_first), ''), last_name = nullif(btrim(p_last), ''),
           email = nullif(btrim(p_email), ''), phone = nullif(btrim(p_phone), ''),
           company = nullif(btrim(p_company), ''), address = nullif(btrim(p_address), ''),
           notes = nullif(btrim(p_notes), ''), updated_at = now()
     where id = v_id;
    insert into public.customer_events (customer_id, kind, detail, created_by)
    values (v_id, 'updated', jsonb_build_object('before', v_before), p_by);
  end if;
  perform public.customer_check_phone(v_id);
  return v_id;
end;
$$;

-- Fusion manuelle : p_absorb est fusionné dans p_keep. Toutes les commandes
-- passent sur p_keep (leurs coordonnées historiques ne changent pas) ; la
-- fiche absorbée reste, marquée « fusionnée dans … ». Deux comptes clients
-- différents ne peuvent pas être fusionnés.
create or replace function public.merge_customers(p_keep uuid, p_absorb uuid, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_keep public.customers%rowtype;
  v_abs public.customers%rowtype;
  v_orders int;
begin
  if p_keep = p_absorb then raise exception 'Choisissez deux fiches différentes' using errcode = 'P0001'; end if;
  select * into v_keep from public.customers where id = p_keep for update;
  select * into v_abs from public.customers where id = p_absorb for update;
  if v_keep.id is null or v_abs.id is null then raise exception 'Client introuvable' using errcode = 'P0002'; end if;
  if v_keep.merged_into is not null or v_abs.merged_into is not null then
    raise exception 'Une des fiches est déjà fusionnée' using errcode = 'P0001';
  end if;
  if v_keep.profile_id is not null and v_abs.profile_id is not null then
    raise exception 'Les deux fiches ont chacune un compte client : fusion impossible' using errcode = 'P0001';
  end if;

  update public.orders set customer_ref_id = p_keep where customer_ref_id = p_absorb;
  get diagnostics v_orders = row_count;

  if v_abs.profile_id is not null then
    update public.customers set profile_id = null where id = p_absorb;
    update public.customers set profile_id = v_abs.profile_id where id = p_keep;
  end if;
  update public.customers
     set notes = nullif(concat_ws(E'\n', notes, case when v_abs.notes is not null then '[Fusion] ' || v_abs.notes end), ''),
         updated_at = now()
   where id = p_keep;
  update public.customers set merged_into = p_keep, merged_at = now(), merged_by = p_by, updated_at = now() where id = p_absorb;

  insert into public.customer_events (customer_id, kind, detail, created_by) values
    (p_keep, 'absorbed', jsonb_build_object('absorbed', p_absorb, 'orders_moved', v_orders, 'absorbed_snapshot', to_jsonb(v_abs) - 'email_norm' - 'phone_norm' - 'name_norm'), p_by),
    (p_absorb, 'merged_into', jsonb_build_object('keep', p_keep), p_by);
  update public.customer_alerts set resolved_at = now(), resolved_by = p_by
   where resolved_at is null and ((customer_id = p_keep and other_customer_id = p_absorb) or (customer_id = p_absorb and other_customer_id = p_keep));
  return jsonb_build_object('keep', p_keep, 'absorbed', p_absorb, 'ordersMoved', v_orders);
end;
$$;

-- Corriger le client d'une commande (ne change rien d'autre à la commande).
create or replace function public.relink_order_customer(p_order uuid, p_customer uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
declare v_old uuid;
begin
  if not exists (select 1 from public.customers where id = p_customer and merged_into is null) then
    raise exception 'Client introuvable ou fusionné' using errcode = 'P0002';
  end if;
  select customer_ref_id into v_old from public.orders where id = p_order for update;
  if not found then raise exception 'Commande introuvable' using errcode = 'P0002'; end if;
  update public.orders set customer_ref_id = p_customer where id = p_order;
  insert into public.customer_events (customer_id, kind, detail, created_by)
  values (p_customer, 'order_relinked', jsonb_build_object('order_id', p_order, 'from', v_old), p_by);
end;
$$;

create or replace function public.resolve_customer_alert(p_id bigint, p_by text)
returns void language sql set search_path to '' as $$
  update public.customer_alerts set resolved_at = now(), resolved_by = p_by where id = p_id and resolved_at is null;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
alter table public.customers enable row level security;
alter table public.customer_alerts enable row level security;
alter table public.customer_events enable row level security;
do $$
declare t text; f text;
begin
  foreach t in array array['customers', 'customer_alerts', 'customer_events'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'norm_email(text)', 'norm_phone(text)', 'norm_name(text)',
    'customer_contradicts(public.customers, text, text)', 'customer_alert(text, uuid, uuid, uuid, text)',
    'customer_check_phone(uuid)', 'customer_fill_blanks(uuid, text, text, text, text)', 'ensure_profile_customer(uuid)', 'link_order_customer(uuid)',
    'order_is_customer_linkable(public.orders)', 'trg_orders_link_customer()', 'trg_profiles_customer()',
    'customer_stats(uuid)', 'admin_customer_list(text, text, boolean, int, int, boolean)', 'admin_customer_detail(uuid)',
    'admin_customer_save(uuid, text, text, text, text, text, text, text, text, boolean)',
    'merge_customers(uuid, uuid, text)', 'relink_order_customer(uuid, uuid, text)', 'resolve_customer_alert(bigint, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

-- ── Reprise des données existantes (aucune suppression, aucun email) ─────
-- 1) un client par compte ; 2) les commandes « enregistrées », de la plus
-- ancienne à la plus récente (même règle que le rattachement automatique).
do $$
declare r record;
begin
  for r in select id from public.profiles order by created_at loop
    perform public.ensure_profile_customer(r.id);
  end loop;
  for r in select o.id from public.orders o
           where o.customer_ref_id is null and public.order_is_customer_linkable(o)
           order by o.created_at loop
    perform public.link_order_customer(r.id);
  end loop;
end $$;

commit;
