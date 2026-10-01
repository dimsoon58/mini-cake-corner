-- F3 — Contrôle commun des remboursements et des décisions.
--
-- Plan v3.1 §4.2 / §4.3, corrigé après relecture (02.10.2026). Toutes les
-- entrées passent par les MÊMES règles : anti-rejeu, validation, plafond,
-- doublon probable, couverture par les décisions.
--   - ingest_refund()            : admin (lot 2), Make (recopie), workshop ;
--   - trg_refund_ledger_guard()  : protège aussi le formulaire admin ACTUEL,
--                                  qui écrit directement dans
--                                  order_manual_refunds (déclencheur créé par F5).
-- Aucune de ces fonctions ne touche payment_status, order_validation, la
-- production, ni n'envoie quoi que ce soit (pas d'e-mail, pas de Make).
--
-- Dates : aucune date n'est inventée. Une date inconnue reste NULL
-- (« à dater ») ; elle est saisie plus tard par set_refund_date().
--
-- Encaissé (order_collected_amount) :
--   payment_status 'paid' / 'refunded' ou paid_at renseigné
--   → paid_amount (commandes manuelles) sinon total_amount ; sinon 0.
--
-- Plafond (refund_reserved_amount) :
--   Σ remboursements 'counted'
--   + Σ remboursements 'to_review' :
--       - doublon suspecté d'une ligne qui réserve déjà (counted / to_review)
--         → seulement la part qui dépasse cette ligne (souvent 0) ;
--       - sinon → leur montant entier.
--
-- Décisions : le total décidé ne dépasse jamais l'encaissé. Une décision
-- saisie par un admin qui dépasserait est refusée ; une décision automatique
-- (annulation workshop, reprise) est réduite au disponible, ou ignorée s'il
-- ne reste rien, et l'écart est noté dans refund_anomalies.
--
-- Fonctions réservées au service_role (Edge Functions admin et triggers).

begin;

-- ── Écriture autorisée dans le registre ──────────────────────────────────
-- Les fonctions de ce fichier ouvrent cette « porte » le temps de leur
-- écriture ; toute autre écriture directe passe par le contrôle du
-- déclencheur trg_refund_ledger_guard (F5).
create or replace function public.refund_ledger_write(p_on boolean)
returns void
language sql
set search_path to ''
as $$
  select set_config('bento.refund_ledger_write', case when p_on then 'on' else 'off' end, true);
$$;

-- ── Montants de base ─────────────────────────────────────────────────────
create or replace function public.order_collected_amount(p_order_id uuid)
returns numeric
language sql
stable
set search_path to ''
as $$
  select case
    when o.payment_status::text in ('paid', 'refunded') or o.paid_at is not null
      then round(coalesce(o.paid_amount, o.total_amount), 2)
    else 0::numeric
  end
  from public.orders o
  where o.id = p_order_id;
$$;

create or replace function public.refund_reserved_amount(p_order_id uuid, p_exclude_id uuid default null)
returns numeric
language sql
stable
set search_path to ''
as $$
  select coalesce(round(sum(
    case
      when r.status = 'counted' then r.amount
      when r.status = 'to_review' and t.id is not null then greatest(r.amount - t.amount, 0)
      when r.status = 'to_review' then r.amount
      else 0
    end), 2), 0)
  from public.order_manual_refunds r
  left join public.order_manual_refunds t
    on t.id = r.duplicate_of
   and t.status in ('counted', 'to_review')
   and t.id is distinct from p_exclude_id
  where r.order_id = p_order_id
    and r.id is distinct from p_exclude_id;
$$;

create or replace function public.order_decided_amount(p_order_id uuid, p_exclude_decision uuid default null)
returns numeric
language sql
stable
set search_path to ''
as $$
  select coalesce(round(sum(amount), 2), 0)
  from public.order_refund_decisions
  where order_id = p_order_id and voided_at is null
    and id is distinct from p_exclude_decision;
$$;

drop function if exists public.order_refund_summary(uuid);
create or replace function public.order_refund_summary(p_order_id uuid)
returns table (
  collected numeric,
  decided numeric,
  refunded numeric,
  undated_amount numeric,
  undated_count bigint,
  to_review_amount numeric,
  to_review_count bigint,
  remaining numeric,
  refund_state text
)
language sql
stable
set search_path to ''
as $$
  with c as (select public.order_collected_amount(p_order_id) as collected),
  d as (select public.order_decided_amount(p_order_id) as decided),
  r as (
    select
      coalesce(round(sum(amount) filter (where status = 'counted'), 2), 0) as refunded,
      coalesce(round(sum(amount) filter (where status = 'counted' and refunded_at is null), 2), 0) as undated_amount,
      count(*) filter (where status = 'counted' and refunded_at is null) as undated_count,
      coalesce(round(sum(amount) filter (where status = 'to_review'), 2), 0) as to_review_amount,
      count(*) filter (where status = 'to_review') as to_review_count
    from public.order_manual_refunds
    where order_id = p_order_id
  )
  select
    c.collected, d.decided, r.refunded, r.undated_amount, r.undated_count,
    r.to_review_amount, r.to_review_count,
    greatest(d.decided - r.refunded, 0) as remaining,
    case
      when r.refunded <= 0 then 'none'
      when r.refunded >= c.collected and c.collected > 0 then 'full'
      else 'partial'
    end as refund_state
  from c, d, r;
$$;

-- ── Doublon probable (face à une AUTRE source, lignes plus anciennes) ────
-- kind 'duplicate' : même référence ; 'to_review' : même montant à ±3 jours
-- (date réelle, sinon date d'enregistrement pour une ligne « à dater »).
create or replace function public.refund_find_duplicate(
  p_order_id uuid, p_source text, p_reference text, p_amount numeric,
  p_at timestamptz, p_exclude_id uuid default null, p_before timestamptz default null
)
returns table (dup_id uuid, dup_amount numeric, kind text)
language sql
stable
set search_path to ''
as $$
  (select r.id, r.amount, 'duplicate'::text
   from public.order_manual_refunds r
   where r.order_id = p_order_id
     and r.id is distinct from p_exclude_id
     and (p_before is null or r.created_at < p_before)
     and r.source <> p_source
     and r.status in ('counted', 'to_review')
     and nullif(trim(p_reference), '') is not null
     and lower(trim(r.reference)) = lower(trim(p_reference))
   order by r.created_at
   limit 1)
  union all
  (select r.id, r.amount, 'to_review'::text
   from public.order_manual_refunds r
   where r.order_id = p_order_id
     and r.id is distinct from p_exclude_id
     and (p_before is null or r.created_at < p_before)
     and r.source <> p_source
     and r.status in ('counted', 'to_review')
     and r.amount = round(p_amount, 2)
     and abs(extract(epoch from (coalesce(r.refunded_at, r.created_at) - p_at))) <= 3 * 86400
   order by r.created_at
   limit 1)
  limit 1;
$$;

-- ── Couverture d'un remboursement compté par les décisions ───────────────
create or replace function public.refresh_auto_refund_decision(p_refund_id uuid, p_by text default null)
returns numeric
language plpgsql
set search_path to ''
as $$
declare
  v_ref public.order_manual_refunds%rowtype;
  v_auto public.order_refund_decisions%rowtype;
  v_other_decided numeric;
  v_refunded numeric;
  v_excess numeric;
begin
  select * into v_ref from public.order_manual_refunds where id = p_refund_id;
  if not found then return 0; end if;

  select * into v_auto from public.order_refund_decisions
  where refund_id = p_refund_id and voided_at is null;

  v_other_decided := public.order_decided_amount(v_ref.order_id, v_auto.id);
  select coalesce(sum(amount), 0) into v_refunded
  from public.order_manual_refunds
  where order_id = v_ref.order_id and status = 'counted';

  v_excess := case when v_ref.status = 'counted'
                   then least(round(v_refunded - v_other_decided, 2), v_ref.amount)
                   else 0 end;

  if v_excess > 0 then
    if v_auto.id is null then
      insert into public.order_refund_decisions (order_id, amount, reason, source, refund_id, decided_at, decided_by)
      values (v_ref.order_id, v_excess, 'Remboursement sans décision préalable (geste commercial)',
              'auto_from_refund', p_refund_id, coalesce(v_ref.refunded_at, v_ref.created_at), coalesce(p_by, v_ref.created_by));
    elsif v_auto.amount <> v_excess then
      update public.order_refund_decisions set amount = v_excess where id = v_auto.id;
    end if;
  elsif v_auto.id is not null then
    update public.order_refund_decisions
       set voided_at = now(), voided_by = coalesce(p_by, 'system'), void_reason = 'Plus d''excédent à couvrir'
     where id = v_auto.id;
  end if;

  return greatest(v_excess, 0);
end;
$$;

-- ── Point d'entrée unique ────────────────────────────────────────────────
-- p_source 'admin' : toute anomalie bloquante lève une erreur (le formulaire
--   l'affiche) ; la date est obligatoire ; un excédent sur le reste à
--   rembourser exige p_allow_gesture.
-- p_source 'make_notion' / 'workshop' : ne lève jamais pour une donnée
--   invalide — la ligne est enregistrée 'rejected' ou 'to_review' avec son
--   motif. Date inconnue → NULL (« à dater »), jamais inventée.
-- Rejeu d'une même source_ref : la MÊME ligne est mise à jour (montant,
--   référence) ; jamais de seconde ligne. Une date déjà saisie n'est pas
--   effacée par un rejeu sans date.
create or replace function public.ingest_refund(
  p_order_id        uuid,
  p_amount          numeric,
  p_refunded_at     timestamptz,
  p_source          text,
  p_source_ref      text default null,
  p_idempotency_key text default null,
  p_method          text default null,
  p_method_detail   text default null,
  p_reference       text default null,
  p_note            text default null,
  p_item_ids        uuid[] default null,
  p_created_by      text default null,
  p_allow_gesture   boolean default false,
  p_confirm_distinct boolean default false
)
returns table (refund_id uuid, status text, review_reason text, created boolean)
language plpgsql
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_existing public.order_manual_refunds%rowtype;
  v_amount numeric := round(p_amount, 2);
  v_ref text := nullif(trim(p_reference), '');
  v_date timestamptz := p_refunded_at;
  v_collected numeric;
  v_reserved numeric;
  v_own_reservation numeric;
  v_status text := 'counted';
  v_reason text := null;
  v_dup_id uuid;
  v_dup_amount numeric;
  v_dup_kind text;
  v_id uuid;
  v_created boolean := true;
  v_items uuid[] := coalesce(p_item_ids, '{}');
  v_bad_items int;
  v_decided numeric;
  v_refunded numeric;
  v_admin boolean := (p_source = 'admin');
begin
  if p_source not in ('admin', 'make_notion', 'workshop') then
    raise exception 'source inconnue %', p_source using errcode = 'P0001';
  end if;

  perform 1 from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Commande introuvable' using errcode = 'P0002';
  end if;

  -- 1. Anti-rejeu : même clé (double clic) ou même référence de source.
  if p_idempotency_key is not null then
    select * into v_existing from public.order_manual_refunds where idempotency_key = p_idempotency_key;
    if found then
      return query select v_existing.id, v_existing.status, v_existing.review_reason, false;
      return;
    end if;
  end if;
  if p_source_ref is not null then
    select * into v_existing from public.order_manual_refunds
    where source = p_source and source_ref = p_source_ref;
    if found then
      v_created := false;
      v_id := v_existing.id;
      -- Rejeu identique : rien ne change.
      if v_existing.amount = v_amount
         and v_existing.refunded_at is not distinct from coalesce(v_date, v_existing.refunded_at)
         and v_existing.reference is not distinct from v_ref
         and not (v_existing.status = 'voided' and coalesce(v_existing.voided_by, '') = 'system') then
        return query select v_existing.id, v_existing.status, v_existing.review_reason, false;
        return;
      end if;
      -- Ligne corrigée (voided) ou classée doublon par un admin : on met à
      -- jour les informations, sans la remettre dans les totaux.
      -- (Une ligne annulée automatiquement par le système — ex. statut
      -- workshop sorti puis revenu à « remboursé » — est en revanche réévaluée.)
      if (v_existing.status = 'voided' and coalesce(v_existing.voided_by, '') <> 'system')
         or (v_existing.status = 'duplicate' and v_existing.reviewed_at is not null) then
        perform public.refund_ledger_write(true);
        update public.order_manual_refunds
           set amount = case when v_amount > 0 then v_amount else amount end,
               refunded_at = coalesce(v_date, refunded_at), reference = coalesce(v_ref, reference),
               updated_at = now()
         where id = v_id;
        perform public.refund_ledger_write(false);
        return query select v_id, v_existing.status, v_existing.review_reason, false;
        return;
      end if;
    end if;
  end if;

  if v_date is null and v_admin then
    raise exception 'La date du remboursement est obligatoire' using errcode = 'P0001';
  end if;

  -- 2. Validation.
  v_collected := public.order_collected_amount(p_order_id);
  select count(*) into v_bad_items
  from unnest(v_items) i
  where not exists (select 1 from public.order_items oi where oi.id = i and oi.order_id = p_order_id);

  if p_amount is null or v_amount <= 0 then
    v_status := 'rejected'; v_reason := 'Montant invalide';
  elsif v_collected <= 0 then
    v_status := 'rejected'; v_reason := 'Commande non encaissée';
  elsif v_bad_items > 0 then
    v_status := 'rejected'; v_reason := 'Article n''appartenant pas à la commande';
  elsif p_method is not null and p_method not in ('postfinance', 'twint', 'bank_transfer', 'cash', 'other') then
    v_status := 'rejected'; v_reason := 'Moyen de remboursement inconnu';
  end if;

  if v_status = 'rejected' and v_admin then
    raise exception '%', v_reason using errcode = 'P0001';
  end if;

  -- 3. Doublon probable (autre source, lignes plus anciennes uniquement).
  if v_status = 'counted' and not p_confirm_distinct then
    select d.dup_id, d.dup_amount, d.kind into v_dup_id, v_dup_amount, v_dup_kind
    from public.refund_find_duplicate(p_order_id, p_source, v_ref, v_amount,
                                      coalesce(v_date, v_existing.created_at, now()), v_id, v_existing.created_at) d;
    if v_dup_kind = 'duplicate' then
      v_status := 'duplicate';
      v_reason := 'Même référence qu''un remboursement déjà enregistré';
    elsif v_dup_kind = 'to_review' then
      v_status := 'to_review';
      v_reason := 'Doublon possible (même montant à ±3 jours)';
    end if;
  end if;

  -- 4. Plafond : comptés + à vérifier (sans double réservation) ≤ encaissé.
  if v_status in ('counted', 'to_review') then
    v_reserved := public.refund_reserved_amount(p_order_id, v_id);
    v_own_reservation := case when v_status = 'to_review' and v_dup_id is not null
                              then greatest(v_amount - v_dup_amount, 0)
                              else v_amount end;
    if v_reserved + v_own_reservation > v_collected + 0.004 then
      if v_admin then
        raise exception 'Le cumul dépasserait le montant encaissé (CHF %). Maximum possible : CHF %.',
          to_char(v_collected, 'FM999999990.00'),
          to_char(greatest(v_collected - v_reserved, 0), 'FM999999990.00')
          using errcode = 'P0001';
      end if;
      v_status := 'to_review';
      v_reason := coalesce(v_reason || ' ; ', '') || 'Dépasse le montant encaissé';
      v_dup_id := null;
    end if;
  end if;

  -- 5. Couverture par les décisions (saisie admin).
  if v_status = 'counted' and v_admin and not p_allow_gesture then
    v_decided := public.order_decided_amount(p_order_id);
    select coalesce(sum(amount), 0) into v_refunded
    from public.order_manual_refunds where order_id = p_order_id and status = 'counted' and id is distinct from v_id;
    if v_refunded + v_amount > v_decided + 0.004 then
      raise exception 'Le montant dépasse le reste à rembourser (CHF %). Cochez « geste commercial » pour enregistrer la différence.',
        to_char(greatest(v_decided - v_refunded, 0), 'FM999999990.00')
        using errcode = 'P0003';
    end if;
  end if;

  -- 6. Écriture.
  perform public.refund_ledger_write(true);
  if v_id is null then
    insert into public.order_manual_refunds (
      order_id, amount, note, created_by, order_item_id,
      refunded_at, method, method_detail, reference, idempotency_key,
      source, source_ref, status, review_reason, duplicate_of
    ) values (
      p_order_id, greatest(coalesce(v_amount, 0), 0.01), nullif(trim(p_note), ''), p_created_by,
      case when cardinality(v_items) = 1 then v_items[1] else null end,
      v_date, p_method, nullif(trim(p_method_detail), ''), v_ref, p_idempotency_key,
      p_source, p_source_ref, v_status, v_reason, v_dup_id
    )
    returning id into v_id;
  else
    update public.order_manual_refunds
       set amount = greatest(coalesce(v_amount, 0), 0.01),
           refunded_at = coalesce(v_date, refunded_at),
           reference = v_ref,
           note = coalesce(nullif(trim(p_note), ''), note),
           order_item_id = case when cardinality(v_items) = 1 then v_items[1] else null end,
           status = v_status, review_reason = v_reason, duplicate_of = v_dup_id,
           voided_at = null, voided_by = null, void_reason = null,
           updated_at = now()
     where id = v_id;
    delete from public.order_manual_refund_items where order_manual_refund_items.refund_id = v_id;
  end if;
  perform public.refund_ledger_write(false);

  if v_status <> 'rejected' then
    insert into public.order_manual_refund_items (refund_id, order_item_id)
    select v_id, i from unnest(v_items) i
    on conflict do nothing;
  end if;

  perform public.refresh_auto_refund_decision(v_id, p_created_by);

  return query select v_id, v_status, v_reason, v_created;
end;
$$;

-- ── Garde du registre : écritures directes (formulaire admin actuel) ─────
-- Déclencheur BEFORE INSERT/UPDATE/DELETE créé par F5. Les fonctions de ce
-- fichier ouvrent la porte (refund_ledger_write) et ne sont pas concernées.
-- Écriture directe :
--   INSERT (formulaire admin actuel, manage-order record_manual_refund) :
--     mêmes règles que ingest_refund source 'admin', avec deux adaptations
--     imposées par ce formulaire qui ne les connaît pas encore :
--       - pas de date → refunded_at NULL (« à dater ») ;
--       - pas de case « geste commercial » → l'excédent éventuel est couvert
--         par une décision automatique (comportement actuel : un
--         remboursement sans décision préalable).
--     Refusé (message affiché par le formulaire) : commande non encaissée,
--     article d'une autre commande, plafond dépassé, même saisie (montant,
--     article, note, auteur) enregistrée il y a moins de 2 minutes.
--   UPDATE de montant / statut / commande / source / date : refusé.
--   DELETE : refusé (on corrige par void_refund_entry, rien n'est supprimé).
create or replace function public.trg_refund_ledger_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_collected numeric;
  v_reserved numeric;
  v_own numeric;
  v_dup_id uuid;
  v_dup_amount numeric;
  v_dup_kind text;
begin
  if coalesce(current_setting('bento.refund_ledger_write', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Suppression interdite : corrigez le remboursement (annulation de la saisie).' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount or new.status is distinct from old.status
       or new.order_id is distinct from old.order_id or new.source is distinct from old.source
       or new.source_ref is distinct from old.source_ref or new.refunded_at is distinct from old.refunded_at
       or new.duplicate_of is distinct from old.duplicate_of or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'Modification directe interdite : utilisez les fonctions du registre.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- INSERT direct (formulaire admin actuel).
  perform 1 from public.orders where id = new.order_id for update;
  v_collected := public.order_collected_amount(new.order_id);
  if coalesce(v_collected, 0) <= 0 then
    raise exception 'Commande non encaissée : aucun remboursement possible.' using errcode = 'P0001';
  end if;
  if new.order_item_id is not null and not exists (
    select 1 from public.order_items oi where oi.id = new.order_item_id and oi.order_id = new.order_id) then
    raise exception 'Article n''appartenant pas à la commande' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.order_manual_refunds r
    where r.order_id = new.order_id
      and r.amount = new.amount
      and r.order_item_id is not distinct from new.order_item_id
      and r.note is not distinct from new.note
      and r.created_by is not distinct from new.created_by
      and r.status <> 'voided'
      and r.created_at > now() - interval '2 minutes') then
    raise exception 'Ce remboursement vient déjà d''être enregistré (double clic ?). Rechargez la page.' using errcode = 'P0001';
  end if;

  new.source := 'admin';
  new.status := 'counted';
  new.review_reason := null;
  new.duplicate_of := null;
  new.source_ref := null;
  new.updated_at := now();

  select d.dup_id, d.dup_amount, d.kind into v_dup_id, v_dup_amount, v_dup_kind
  from public.refund_find_duplicate(new.order_id, 'admin', new.reference, new.amount,
                                    coalesce(new.refunded_at, now())) d;
  if v_dup_kind = 'duplicate' then
    new.status := 'duplicate'; new.review_reason := 'Même référence qu''un remboursement déjà enregistré'; new.duplicate_of := v_dup_id;
  elsif v_dup_kind = 'to_review' then
    new.status := 'to_review'; new.review_reason := 'Doublon possible (même montant à ±3 jours)'; new.duplicate_of := v_dup_id;
  end if;

  if new.status in ('counted', 'to_review') then
    v_reserved := public.refund_reserved_amount(new.order_id);
    v_own := case when new.status = 'to_review' then greatest(new.amount - v_dup_amount, 0) else new.amount end;
    if v_reserved + v_own > v_collected + 0.004 then
      raise exception 'Le cumul dépasserait le montant encaissé (CHF %). Maximum possible : CHF %.',
        to_char(v_collected, 'FM999999990.00'), to_char(greatest(v_collected - v_reserved, 0), 'FM999999990.00')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Après insertion (toute origine) : article rattaché + couverture par décision.
create or replace function public.trg_refund_ledger_after_insert()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.order_item_id is not null and new.status <> 'rejected' then
    insert into public.order_manual_refund_items (refund_id, order_item_id)
    values (new.id, new.order_item_id)
    on conflict do nothing;
  end if;
  perform public.refresh_auto_refund_decision(new.id, new.created_by);
  return null;
end;
$$;

-- ── Vérification d'une ligne « à vérifier » ──────────────────────────────
create or replace function public.review_refund(p_refund_id uuid, p_decision text, p_by text)
returns table (refund_id uuid, status text)
language plpgsql
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_ref public.order_manual_refunds%rowtype;
  v_collected numeric;
  v_reserved numeric;
begin
  if p_decision not in ('distinct', 'duplicate') then
    raise exception 'Décision inconnue' using errcode = 'P0001';
  end if;
  select * into v_ref from public.order_manual_refunds where id = p_refund_id;
  if not found then raise exception 'Remboursement introuvable' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_ref.order_id for update;
  select * into v_ref from public.order_manual_refunds where id = p_refund_id for update;
  if v_ref.status <> 'to_review' then
    raise exception 'Ce remboursement n''est pas à vérifier' using errcode = 'P0001';
  end if;

  perform public.refund_ledger_write(true);
  if p_decision = 'distinct' then
    v_collected := public.order_collected_amount(v_ref.order_id);
    v_reserved := public.refund_reserved_amount(v_ref.order_id, v_ref.id);
    if v_reserved + v_ref.amount > v_collected + 0.004 then
      raise exception 'Le cumul dépasserait le montant encaissé (CHF %). Maximum possible : CHF %.',
        to_char(v_collected, 'FM999999990.00'), to_char(greatest(v_collected - v_reserved, 0), 'FM999999990.00')
        using errcode = 'P0001';
    end if;
    update public.order_manual_refunds
       set status = 'counted', duplicate_of = null, reviewed_at = now(), reviewed_by = p_by, updated_at = now()
     where id = p_refund_id;
  else
    update public.order_manual_refunds
       set status = 'duplicate', reviewed_at = now(), reviewed_by = p_by, updated_at = now()
     where id = p_refund_id;
  end if;
  perform public.refund_ledger_write(false);

  perform public.refresh_auto_refund_decision(p_refund_id, p_by);
  return query select p_refund_id, (select r.status from public.order_manual_refunds r where r.id = p_refund_id);
end;
$$;

-- ── Correction d'une saisie ──────────────────────────────────────────────
create or replace function public.void_refund_entry(p_refund_id uuid, p_reason text, p_by text)
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_ref public.order_manual_refunds%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire' using errcode = 'P0001';
  end if;
  select * into v_ref from public.order_manual_refunds where id = p_refund_id;
  if not found then raise exception 'Remboursement introuvable' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_ref.order_id for update;
  if v_ref.status = 'voided' then return; end if;
  perform public.refund_ledger_write(true);
  update public.order_manual_refunds
     set status = 'voided', voided_at = now(), voided_by = p_by, void_reason = trim(p_reason), updated_at = now()
   where id = p_refund_id;
  perform public.refund_ledger_write(false);
  perform public.refresh_auto_refund_decision(p_refund_id, p_by);
end;
$$;

-- ── Dater un remboursement « à dater » (ou corriger sa date) ─────────────
-- Ne change ni le montant, ni le statut, ni le cashback.
create or replace function public.set_refund_date(p_refund_id uuid, p_refunded_at timestamptz, p_by text)
returns void
language plpgsql
set search_path to ''
as $$
begin
  if p_refunded_at is null then
    raise exception 'La date est obligatoire' using errcode = 'P0001';
  end if;
  if p_refunded_at > now() + interval '1 day' then
    raise exception 'La date ne peut pas être dans le futur' using errcode = 'P0001';
  end if;
  perform public.refund_ledger_write(true);
  update public.order_manual_refunds
     set refunded_at = p_refunded_at,
         note = coalesce(nullif(note, '') || ' | ', '') || format('Daté le %s par %s', to_char(now(), 'YYYY-MM-DD'), coalesce(p_by, '?')),
         updated_at = now()
   where id = p_refund_id;
  perform public.refund_ledger_write(false);
  if not found then raise exception 'Remboursement introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- ── Décisions ────────────────────────────────────────────────────────────
-- p_on_excess = 'raise' (admin) : refusée si le total décidé dépasserait
--   l'encaissé.
-- p_on_excess = 'clamp' (automatique) : réduite au disponible, ou ignorée
--   s'il ne reste rien ; l'écart est noté dans refund_anomalies. Jamais
--   d'erreur.
drop function if exists public.record_refund_decision(uuid, numeric, text, text, text, uuid[], text, text, boolean);
create or replace function public.record_refund_decision(
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_source text,
  p_idempotency_key text default null,
  p_item_ids uuid[] default null,
  p_by text default null,
  p_source_ref text default null,
  p_on_excess text default 'raise'
)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_id uuid;
  v_amount numeric := round(p_amount, 2);
  v_room numeric;
  v_recorded numeric;
begin
  if p_source not in ('admin_cancel', 'admin_gesture', 'make_cancel', 'workshop_cancel', 'legacy_due') then
    raise exception 'source de décision inconnue %', p_source using errcode = 'P0001';
  end if;
  if p_on_excess not in ('raise', 'clamp') then
    raise exception 'p_on_excess inconnu' using errcode = 'P0001';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'Commande introuvable' using errcode = 'P0002'; end if;

  if p_idempotency_key is not null then
    select id into v_id from public.order_refund_decisions where idempotency_key = p_idempotency_key;
    if found then return v_id; end if;
  end if;
  if p_source_ref is not null then
    select id into v_id from public.order_refund_decisions where source = p_source and source_ref = p_source_ref;
    if found then return v_id; end if;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Montant invalide' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(coalesce(p_item_ids, '{}')) i
             where not exists (select 1 from public.order_items oi where oi.id = i and oi.order_id = p_order_id)) then
    raise exception 'Article n''appartenant pas à la commande' using errcode = 'P0001';
  end if;

  v_room := greatest(public.order_collected_amount(p_order_id) - public.order_decided_amount(p_order_id), 0);
  v_recorded := least(v_amount, v_room);

  if v_recorded < v_amount then
    if p_on_excess = 'raise' then
      raise exception 'Le total décidé dépasserait le montant encaissé. Maximum possible : CHF %.',
        to_char(v_room, 'FM999999990.00') using errcode = 'P0001';
    end if;
    insert into public.refund_anomalies (order_id, kind, source, source_ref, requested, recorded, detail)
    values (p_order_id,
            case when v_recorded > 0 then 'decision_reduite' else 'decision_ignoree' end,
            p_source, p_source_ref, v_amount, v_recorded,
            'Le total décidé aurait dépassé le montant encaissé : décision réduite au disponible.')
    on conflict do nothing;
    if v_recorded <= 0 then
      return null;
    end if;
  end if;

  insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, idempotency_key, decided_by)
  values (p_order_id, v_recorded, nullif(trim(p_reason), ''), p_source, p_source_ref, p_idempotency_key, p_by)
  returning id into v_id;

  insert into public.order_refund_decision_items (decision_id, order_item_id)
  select v_id, i from unnest(coalesce(p_item_ids, '{}')) i
  on conflict do nothing;

  return v_id;
end;
$$;

-- Décision liée à une annulation workshop : créée, puis tenue à jour si le
-- montant dû change, toujours dans la limite de l'encaissé (anomalie sinon).
create or replace function public.sync_workshop_cancel_decision(p_log_id uuid)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_log public.workshop_cancellation_log%rowtype;
  v_order_id uuid;
  v_item_id uuid;
  v_dec public.order_refund_decisions%rowtype;
  v_target numeric;
  v_room numeric;
  v_recorded numeric;
begin
  select * into v_log from public.workshop_cancellation_log where id = p_log_id;
  if not found then return null; end if;
  select wr.order_id, wr.order_item_id into v_order_id, v_item_id
  from public.workshop_reservations wr where wr.id = v_log.reservation_id;
  if v_order_id is null then return null; end if;
  perform 1 from public.orders where id = v_order_id for update;

  select * into v_dec from public.order_refund_decisions
  where source = 'workshop_cancel' and source_ref = p_log_id::text;

  v_target := round(coalesce(v_log.refund_amount_requested, 0), 2);
  v_room := greatest(public.order_collected_amount(v_order_id) - public.order_decided_amount(v_order_id, v_dec.id), 0);
  v_recorded := least(v_target, v_room);

  if v_recorded < v_target then
    insert into public.refund_anomalies (order_id, kind, source, source_ref, requested, recorded, detail)
    values (v_order_id, case when v_recorded > 0 then 'decision_reduite' else 'decision_ignoree' end,
            'workshop_cancel', p_log_id::text, v_target, v_recorded,
            'Le total décidé aurait dépassé le montant encaissé : décision réduite au disponible.')
    on conflict do nothing;
  end if;

  if v_dec.id is null then
    if v_recorded > 0 then
      insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, decided_at, decided_by)
      values (v_order_id, v_recorded, format('Annulation de %s place(s) workshop', v_log.seats_cancelled),
              'workshop_cancel', p_log_id::text, v_log.created_at, 'system')
      returning * into v_dec;
      insert into public.order_refund_decision_items (decision_id, order_item_id)
      values (v_dec.id, v_item_id) on conflict do nothing;
    end if;
  elsif v_recorded <= 0 then
    if v_dec.voided_at is null then
      update public.order_refund_decisions
         set voided_at = now(), voided_by = 'system', void_reason = 'Montant dû workshop ramené à 0'
       where id = v_dec.id;
    end if;
  elsif v_dec.amount <> v_recorded or v_dec.voided_at is not null then
    update public.order_refund_decisions
       set amount = v_recorded, voided_at = null, voided_by = null, void_reason = null
     where id = v_dec.id;
  end if;
  return v_dec.id;
end;
$$;

create or replace function public.void_refund_decision(p_decision_id uuid, p_reason text, p_by text)
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_dec public.order_refund_decisions%rowtype;
  v_refunded numeric;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire' using errcode = 'P0001';
  end if;
  select * into v_dec from public.order_refund_decisions where id = p_decision_id;
  if not found then raise exception 'Décision introuvable' using errcode = 'P0002'; end if;
  perform 1 from public.orders where id = v_dec.order_id for update;
  if v_dec.voided_at is not null then return; end if;
  if v_dec.source = 'auto_from_refund' then
    raise exception 'Cette décision suit un remboursement : corrigez le remboursement' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_refunded
  from public.order_manual_refunds where order_id = v_dec.order_id and status = 'counted';
  if public.order_decided_amount(v_dec.order_id, p_decision_id) + 0.004 < v_refunded then
    raise exception 'Des remboursements déjà effectués dépendent de cette décision : corrigez d''abord le remboursement' using errcode = 'P0001';
  end if;

  update public.order_refund_decisions
     set voided_at = now(), voided_by = p_by, void_reason = trim(p_reason)
   where id = p_decision_id;
end;
$$;

-- ── Marquage test (appelé par l'admin après confirmation) ────────────────
create or replace function public.set_order_test_flag(p_order_id uuid, p_is_test boolean, p_by text)
returns void
language sql
set search_path to ''
as $$
  update public.orders
     set is_test = p_is_test,
         test_marked_at = now(),
         test_marked_by = p_by
   where id = p_order_id;
$$;

-- ── Droits : service_role uniquement ─────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'refund_ledger_write(boolean)',
    'order_collected_amount(uuid)',
    'refund_reserved_amount(uuid, uuid)',
    'order_decided_amount(uuid, uuid)',
    'order_refund_summary(uuid)',
    'refund_find_duplicate(uuid, text, text, numeric, timestamptz, uuid, timestamptz)',
    'refresh_auto_refund_decision(uuid, text)',
    'ingest_refund(uuid, numeric, timestamptz, text, text, text, text, text, text, text, uuid[], text, boolean, boolean)',
    'trg_refund_ledger_guard()',
    'trg_refund_ledger_after_insert()',
    'review_refund(uuid, text, text)',
    'void_refund_entry(uuid, text, text)',
    'set_refund_date(uuid, timestamptz, text)',
    'record_refund_decision(uuid, numeric, text, text, text, uuid[], text, text, text)',
    'sync_workshop_cancel_decision(uuid)',
    'void_refund_decision(uuid, text, text)',
    'set_order_test_flag(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

commit;
