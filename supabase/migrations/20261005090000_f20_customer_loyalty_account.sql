-- F20 — Admin > Clients : historique de la cagnotte, crédit manuel, dates
-- newsletter, offre de bienvenue, actions sur le compte, source de la
-- première commande. À appliquer après F8 (et F1–F19). Ne rejoue aucune
-- migration. Aucune donnée existante n'est recalculée ni modifiée :
--   * la cagnotte reste celle du compte client (reward_transactions /
--     profiles.reward_balance) : pas de deuxième système ; l'historique est
--     LU à partir des registres existants ;
--   * le crédit manuel est un lot « earned » de la cagnotte existante (même
--     calcul de solde ; le déclencheur existant des profils l'envoie au
--     webhook Make comme tout changement de solde — le scénario Notion
--     7131969 est DÉSACTIVÉ : Notion n'est pas mis à jour), tracé dans
--     reward_manual_credits (qui, quand, motif, clé anti double clic) ;
--   * newsletter : deux colonnes de date, remplies seulement à partir de
--     maintenant (jamais inventées pour les anciens abonnés) ;
--   * les actions sur le compte (invitation, activation, mot de passe,
--     email de connexion) sont faites par la fonction manage-customers ;
--     ici seulement le journal et la garde anti double clic.

begin;

-- ── Crédits manuels (traçabilité + anti double clic) ─────────────────────
create table if not exists public.reward_manual_credits (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  profile_id      uuid not null references public.profiles(id),
  amount          numeric(12,2) not null check (amount > 0 and amount <= 500),
  reason          text not null check (length(btrim(reason)) > 0),
  transaction_id  uuid not null references public.reward_transactions(id),
  idempotency_key text not null unique,
  created_by      text not null,
  created_at      timestamptz not null default now()
);
create index if not exists reward_manual_credits_profile_idx on public.reward_manual_credits (profile_id, created_at);
alter table public.reward_manual_credits enable row level security;
revoke all on table public.reward_manual_credits from public, anon, authenticated;
grant select, insert on table public.reward_manual_credits to service_role;

-- ── Journal de la fiche : nouveaux types d'événements ────────────────────
alter table public.customer_events drop constraint if exists customer_events_kind_check;
alter table public.customer_events add constraint customer_events_kind_check check (kind in (
  'created', 'updated', 'merged_into', 'absorbed', 'order_relinked',
  'reward_credit', 'account_invite', 'account_resend', 'password_reset', 'login_email_change'));

-- ── Newsletter : dates d'inscription / de désinscription (à partir d'ici) ─
alter table public.profiles add column if not exists newsletter_subscribed_at timestamptz;
alter table public.profiles add column if not exists newsletter_unsubscribed_at timestamptz;

create or replace function public.trg_profiles_newsletter_dates()
returns trigger language plpgsql set search_path to '' as $$
begin
  if tg_op = 'INSERT' then
    new.newsletter_subscribed_at := case when new.newsletter_subscription then now() end;
    new.newsletter_unsubscribed_at := null;
    return new;
  end if;
  -- Les dates ne bougent que si l'abonnement change réellement.
  new.newsletter_subscribed_at := old.newsletter_subscribed_at;
  new.newsletter_unsubscribed_at := old.newsletter_unsubscribed_at;
  if new.newsletter_subscription and not old.newsletter_subscription then
    new.newsletter_subscribed_at := now();
  elsif old.newsletter_subscription and not new.newsletter_subscription then
    new.newsletter_unsubscribed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_profiles_newsletter_dates on public.profiles;
create trigger trg_profiles_newsletter_dates before insert or update on public.profiles
  for each row execute function public.trg_profiles_newsletter_dates();

-- ── Historique de la cagnotte (lecture seule, registres existants) ───────
-- Montants signés : + gagné / rendu / crédité, − utilisé / retiré / expiré.
-- Rien n'est recalculé : le solde affiché reste profiles.reward_balance ;
-- « computedBalance » (somme des lots valides, même règle que
-- recompute_reward_balance) sert seulement à signaler un écart.
create or replace function public.admin_reward_history(p_profile uuid)
returns jsonb language sql stable set search_path to '' as $$
  with lots as (
    select t.*, o.order_number,
           coalesce((select sum(i.amount) from public.reward_reservation_items i
                     join public.reward_reservations r on r.order_id = i.order_id
                     where i.reward_transaction_id = t.id and r.status in ('reserved', 'consumed')), 0) as allocated
    from public.reward_transactions t
    left join public.orders o on o.id = t.order_id
    where t.customer_id = p_profile
  ),
  ws as (
    select l.id, l.reward_amount_restored as amount, l.updated_at, r.order_id, o.order_number
    from public.workshop_cancellation_log l
    join public.workshop_reservations r on r.id = l.reservation_id
    join public.orders o on o.id = r.order_id
    where o.customer_id = p_profile and l.reward_amount_restored > 0
  ),
  manual as (
    select m.*, t.expires_at from public.reward_manual_credits m join public.reward_transactions t on t.id = m.transaction_id
    where m.profile_id = p_profile
  ),
  adj as (
    select o.id as order_id, o.order_number, o.cashback_refund_adjustment as amount,
           coalesce((select max(r.refunded_at) from public.order_manual_refunds r where r.order_id = o.id and r.status = 'counted'),
                    o.cashback_refund_initialized_at) as at
    from public.orders o
    where o.customer_id = p_profile and coalesce(o.cashback_refund_adjustment, 0) > 0
  ),
  ev as (
    -- Gagné sur une commande (hors places de workshop rendues, listées à part).
    select l.created_at as at, 'earned' as kind,
           l.amount - coalesce((select sum(w.amount) from ws w where w.order_id = l.order_id), 0) as amount,
           l.order_id, l.order_number, null::text as reason, null::text as by, l.expires_at
    from lots l where l.type = 'earned' and l.order_id is not null
    union all
    select w.updated_at, 'restored_workshop', w.amount, w.order_id, w.order_number, 'Annulation de places de workshop', null, null
    from ws w
    union all
    -- Cagnotte utilisée rendue après une commande remboursée.
    select l.created_at, 'restored_refund', l.amount, s.order_id, so.order_number, 'Commande remboursée', null, l.expires_at
    from lots l
    join public.reward_transactions s on s.id = l.source_transaction_id
    left join public.orders so on so.id = s.order_id
    where l.type = 'earned' and l.order_id is null and l.note = 'Reward restored after refunded order'
    union all
    select m.created_at, 'manual_credit', m.amount, null, null, m.reason, m.created_by, m.expires_at
    from manual m
    union all
    -- Autres crédits sans commande (avant l'admin : origine d'après la note).
    select l.created_at, 'other_credit', l.amount, null, null, coalesce(l.note, 'Crédit sans motif enregistré'), null, l.expires_at
    from lots l
    where l.type = 'earned' and l.order_id is null
      and l.note is distinct from 'Reward restored after refunded order'
      and not exists (select 1 from manual m where m.transaction_id = l.id)
    union all
    select l.created_at, 'spent', -l.amount, l.order_id, l.order_number, null, null, null
    from lots l where l.type = 'spent'
    union all
    select r.created_at, 'reserved', -r.amount, r.order_id, o.order_number, 'Paiement en cours', null, r.expires_at
    from public.reward_reservations r left join public.orders o on o.id = r.order_id
    where r.customer_id = p_profile and r.status = 'reserved'
    union all
    -- Retrait réel après remboursement partiel (F4/F5, une seule fois par commande).
    select a.at, 'refund_adjustment', -a.amount, a.order_id, a.order_number, 'Remboursement client', null, null
    from adj a
    union all
    -- Commande remboursée en entier : cashback restant annulé (ancien mécanisme).
    select coalesce((select max(r.refunded_at) from public.order_manual_refunds r where r.order_id = l.order_id and r.status = 'counted'), o.cancelled_at),
           'refund_cancelled',
           -greatest(l.amount - l.allocated - coalesce(o.cashback_refund_adjustment, 0) - l.remaining_amount, 0),
           l.order_id, l.order_number, 'Commande remboursée', null, null
    from lots l join public.orders o on o.id = l.order_id
    where l.type = 'earned' and l.note like '%Cashback cancelled after refunded order%'
      and l.amount - l.allocated - coalesce(o.cashback_refund_adjustment, 0) - l.remaining_amount > 0
    union all
    select l.expires_at, 'expired', -l.remaining_amount, l.order_id, l.order_number, null, null, l.expires_at
    from lots l where l.type = 'earned' and l.remaining_amount > 0 and l.expires_at is not null and l.expires_at <= now()
    union all
    -- Types réservés par la contrainte mais non utilisés par le code connu.
    select l.created_at, 'raw_' || l.type, case when l.type = 'expired' then -l.amount else l.amount end,
           l.order_id, l.order_number, l.note, null, null
    from lots l where l.type in ('expired', 'adjustment')
  )
  select jsonb_build_object(
    'balance', (select reward_balance from public.profiles where id = p_profile),
    'computedBalance', coalesce((select round(sum(remaining_amount), 2) from lots
                                 where type = 'earned' and remaining_amount > 0 and (expires_at is null or expires_at > now())), 0),
    'nextExpiry', (select min(expires_at) from lots where type = 'earned' and remaining_amount > 0 and expires_at > now()),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'at', e.at, 'kind', e.kind, 'amount', round(e.amount, 2), 'orderId', e.order_id, 'orderNumber', e.order_number,
        'reason', e.reason, 'by', e.by, 'expiresAt', e.expires_at) order by e.at desc nulls last)
      from ev e where e.amount <> 0), '[]'::jsonb)
  );
$$;

-- ── Crédit manuel (montant en CHF, motif obligatoire, une fois par clé) ──
create or replace function public.admin_reward_credit(p_customer uuid, p_amount numeric, p_reason text, p_by text, p_key text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_c public.customers%rowtype;
  v_done public.reward_manual_credits%rowtype;
  v_tx uuid;
  v_amount numeric(12,2) := round(p_amount, 2);
  v_balance numeric;
begin
  if coalesce(btrim(p_key), '') = '' then raise exception 'Clé de requête manquante' using errcode = 'P0001'; end if;
  -- Double clic / nouvelle tentative : le premier crédit, jamais un second.
  select * into v_done from public.reward_manual_credits where idempotency_key = p_key;
  if found then
    return jsonb_build_object('id', v_done.id, 'amount', v_done.amount, 'replayed', true,
                              'balance', (select reward_balance from public.profiles where id = v_done.profile_id));
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  if v_amount > 500 then raise exception 'Montant trop élevé (maximum CHF 500 par crédit)' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Motif obligatoire' using errcode = 'P0001'; end if;
  select * into v_c from public.customers where id = p_customer;
  if not found or v_c.merged_into is not null then raise exception 'Client introuvable ou fusionné' using errcode = 'P0002'; end if;
  if v_c.profile_id is null then raise exception 'Ce client n''a pas de compte : pas de cagnotte à créditer' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('reward-credit:' || p_key));
  select * into v_done from public.reward_manual_credits where idempotency_key = p_key;
  if found then
    return jsonb_build_object('id', v_done.id, 'amount', v_done.amount, 'replayed', true,
                              'balance', (select reward_balance from public.profiles where id = v_done.profile_id));
  end if;

  -- Un lot de la cagnotte existante, valable un an comme tous les autres.
  insert into public.reward_transactions (customer_id, order_id, type, amount, remaining_amount, expires_at, note)
  values (v_c.profile_id, null, 'earned', v_amount, v_amount, now() + interval '1 year', 'Crédit manuel : ' || btrim(p_reason))
  returning id into v_tx;
  insert into public.reward_manual_credits (customer_id, profile_id, amount, reason, transaction_id, idempotency_key, created_by)
  values (v_c.id, v_c.profile_id, v_amount, btrim(p_reason), v_tx, p_key, p_by)
  returning * into v_done;
  v_balance := public.recompute_reward_balance(v_c.profile_id);
  insert into public.customer_events (customer_id, kind, detail, created_by)
  values (v_c.id, 'reward_credit', jsonb_build_object('amount', v_amount, 'reason', btrim(p_reason), 'credit_id', v_done.id), p_by);
  return jsonb_build_object('id', v_done.id, 'amount', v_amount, 'replayed', false, 'balance', v_balance);
end;
$$;

-- ── Actions sur le compte : journal + garde anti double clic ─────────────
-- begin : refuse la même action envoyant un e-mail sur la même fiche moins
-- de 60 s après la précédente (évite deux e-mails) ; finish : enregistre le
-- résultat.
create or replace function public.customer_account_action_begin(p_customer uuid, p_kind text, p_detail jsonb, p_by text)
returns bigint language plpgsql set search_path to '' as $$
declare v_id bigint;
begin
  if p_kind not in ('account_invite', 'account_resend', 'password_reset', 'login_email_change') then
    raise exception 'Action inconnue' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and merged_into is null) then
    raise exception 'Client introuvable ou fusionné' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('customer-account:' || p_customer::text || ':' || p_kind));
  -- Seulement pour les actions qui envoient un e-mail.
  if p_kind <> 'login_email_change' and exists (select 1 from public.customer_events where customer_id = p_customer and kind = p_kind
             and created_at > now() - interval '60 seconds' and coalesce(detail ->> 'result', 'pending') in ('pending', 'ok')) then
    raise exception 'Action déjà faite il y a moins d''une minute : attendez avant de recommencer' using errcode = 'P0001';
  end if;
  insert into public.customer_events (customer_id, kind, detail, created_by)
  values (p_customer, p_kind, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('result', 'pending'), p_by)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.customer_account_action_finish(p_event bigint, p_result text, p_message text)
returns void language sql set search_path to '' as $$
  update public.customer_events
     set detail = detail || jsonb_build_object('result', p_result, 'message', p_message, 'finished_at', now())
   where id = p_event;
$$;

-- Après une invitation : le nouveau compte est rattaché à CETTE fiche. Si le
-- déclencheur des profils a créé une fiche vide à part (noms différents),
-- elle est fusionnée ici ; une fiche qui a déjà des commandes n'est jamais
-- fusionnée automatiquement (alerte à la place).
create or replace function public.customer_attach_profile(p_customer uuid, p_profile uuid, p_by text)
returns text language plpgsql set search_path to '' as $$
declare v_other public.customers%rowtype;
begin
  if exists (select 1 from public.customers where id = p_customer and profile_id = p_profile) then return 'linked'; end if;
  select * into v_other from public.customers where profile_id = p_profile and merged_into is null;
  if not found then
    update public.customers set profile_id = p_profile, updated_at = now() where id = p_customer and profile_id is null;
    return 'linked';
  end if;
  if v_other.source = 'profile' and not exists (select 1 from public.orders where customer_ref_id = v_other.id) then
    perform public.merge_customers(p_customer, v_other.id, p_by);
    return 'merged';
  end if;
  perform public.customer_alert('contradiction', p_customer, v_other.id, null, 'Compte invité rattaché à une autre fiche : à vérifier');
  return 'other_record';
end;
$$;

-- Données nécessaires aux actions sur le compte (fonction manage-customers).
create or replace function public.admin_customer_account_target(p_customer uuid)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('customerId', c.id, 'mergedInto', c.merged_into, 'contactEmail', c.email,
           'firstName', c.first_name, 'lastName', c.last_name, 'phone', c.phone,
           'profileId', c.profile_id, 'loginEmail', p.email)
  from public.customers c left join public.profiles p on p.id = c.profile_id
  where c.id = p_customer;
$$;

-- Email de connexion changé dans Auth : le profil suit (l'email de CONTACT
-- de la fiche ne change pas).
create or replace function public.admin_profile_set_email(p_profile uuid, p_email text)
returns void language sql set search_path to '' as $$
  update public.profiles set email = lower(btrim(p_email)), updated_at = now() where id = p_profile;
$$;

-- ── Fiche client : + historique cagnotte, newsletter, bienvenue, source ──
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
        'welcomeExpiresAt', p.welcome_discount_expires_at, 'welcomeReservedAt', p.welcome_discount_reserved_at,
        'welcomeUsedOrder', (select o.order_number from public.orders o
                             where o.customer_id = p.id and coalesce(o.welcome_discount_amount, 0) > 0
                               and o.payment_status::text in ('paid', 'refunded') order by o.created_at limit 1),
        'newsletter', p.newsletter_subscription,
        'newsletterSubscribedAt', p.newsletter_subscribed_at, 'newsletterUnsubscribedAt', p.newsletter_unsubscribed_at,
        'createdAt', p.created_at, 'rewards', public.admin_reward_history(p.id))
      from public.profiles p where p.id = c.profile_id),
    -- Source de la première commande (hors tests et brouillons) : site, ou
    -- canal saisi sur une commande manuelle ; inconnue sinon (jamais inventée).
    'firstOrder', (select jsonb_build_object('orderId', o.id, 'orderNumber', o.order_number, 'createdAt', o.created_at,
        'source', case when public.order_origin(o.order_number, o.order_source) = 'website' then 'website'
                       else o.order_channel end)
      from public.orders o
      where o.customer_ref_id = c.id and not coalesce(o.is_test, false) and not coalesce(o.is_draft, false)
      order by o.created_at limit 1),
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

do $$
declare f text;
begin
  foreach f in array array['admin_reward_history(uuid)', 'admin_reward_credit(uuid, numeric, text, text, text)',
    'customer_account_action_begin(uuid, text, jsonb, text)', 'customer_account_action_finish(bigint, text, text)',
    'customer_attach_profile(uuid, uuid, text)', 'admin_customer_account_target(uuid)', 'admin_profile_set_email(uuid, text)',
    'admin_customer_detail(uuid)', 'trg_profiles_newsletter_dates()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

commit;
