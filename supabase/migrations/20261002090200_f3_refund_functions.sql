-- F3 — Contrôle commun des remboursements et des décisions.
--
-- Plan v3 §4.2 / §4.3. Toutes les entrées (admin, Make, workshop) passent par
-- ingest_refund() : anti-rejeu, validation, plafond, doublon probable,
-- couverture par les décisions. Aucune de ces fonctions ne touche
-- payment_status, order_validation, la production, ni n'envoie quoi que ce
-- soit (pas d'e-mail, pas de Make).
--
-- Encaissé d'une commande (order_collected_amount) :
--   payment_status 'paid' / 'refunded' ou paid_at renseigné
--   → paid_amount (commandes manuelles) sinon total_amount ; sinon 0.
--
-- Plafond (refund_reserved_amount) :
--   Σ remboursements 'counted'
--   + Σ remboursements 'to_review' :
--       - suspectés doublon d'une ligne qui réserve déjà (counted / to_review)
--         → seulement la part qui dépasse cette ligne (souvent 0) ;
--       - sinon → leur montant entier.
--   Ainsi un doublon suspecté ne réserve pas deux fois le même argent, mais
--   une ligne à vérifier pour une autre raison bloque bien le plafond.
--
-- Fonctions réservées au service_role (Edge Functions admin et triggers).

begin;

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

create or replace function public.order_refund_summary(p_order_id uuid)
returns table (
  collected numeric,
  decided numeric,
  refunded numeric,
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
  d as (
    select coalesce(round(sum(amount), 2), 0) as decided
    from public.order_refund_decisions
    where order_id = p_order_id and voided_at is null
  ),
  r as (
    select
      coalesce(round(sum(amount) filter (where status = 'counted'), 2), 0) as refunded,
      coalesce(round(sum(amount) filter (where status = 'to_review'), 2), 0) as to_review_amount,
      count(*) filter (where status = 'to_review') as to_review_count
    from public.order_manual_refunds
    where order_id = p_order_id
  )
  select
    c.collected,
    d.decided,
    r.refunded,
    r.to_review_amount,
    r.to_review_count,
    greatest(d.decided - r.refunded, 0) as remaining,
    case
      when r.refunded <= 0 then 'none'
      when r.refunded >= c.collected and c.collected > 0 then 'full'
      else 'partial'
    end as refund_state
  from c, d, r;
$$;

-- ── Couverture d'un remboursement compté par les décisions ───────────────
-- Recalcule la décision automatique liée à ce remboursement : elle couvre
-- exactement l'excédent (Σ comptés − Σ autres décisions actives), ou est
-- annulée s'il n'y a plus d'excédent. Une seule par remboursement.
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

  select coalesce(sum(amount), 0) into v_other_decided
  from public.order_refund_decisions
  where order_id = v_ref.order_id and voided_at is null
    and id is distinct from v_auto.id;

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
--   l'affiche) ; un excédent sur le reste à rembourser exige p_allow_gesture.
-- p_source 'make_notion' / 'workshop' : ne lève jamais pour une donnée
--   invalide — la ligne est enregistrée 'rejected' ou 'to_review' avec son
--   motif, pour que l'appel d'origine (Make) ne casse pas.
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
  v_order public.orders%rowtype;
  v_existing public.order_manual_refunds%rowtype;
  v_amount numeric := round(p_amount, 2);
  v_ref text := nullif(trim(p_reference), '');
  v_date timestamptz := p_refunded_at;
  v_collected numeric;
  v_reserved numeric;
  v_own_reservation numeric;
  v_status text := 'counted';
  v_reason text := null;
  v_dup public.order_manual_refunds%rowtype;
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

  select * into v_order from public.orders where id = p_order_id for update;
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
      -- Rejeu identique (même montant, même date, même référence) : rien ne change.
      if v_existing.amount = v_amount
         and v_existing.refunded_at is not distinct from coalesce(v_date, v_existing.refunded_at)
         and v_existing.reference is not distinct from v_ref then
        return query select v_existing.id, v_existing.status, v_existing.review_reason, false;
        return;
      end if;
      -- Une ligne corrigée ou déjà classée doublon par un admin le reste.
      if v_existing.status in ('voided', 'duplicate') and v_existing.reviewed_at is not null
         or v_existing.status = 'voided' then
        update public.order_manual_refunds
           set amount = case when v_amount > 0 then v_amount else amount end,
               refunded_at = coalesce(v_date, refunded_at), reference = coalesce(v_ref, reference),
               updated_at = now()
         where id = v_id;
        return query select v_id, v_existing.status, v_existing.review_reason, false;
        return;
      end if;
    end if;
  end if;

  if v_date is null then
    if v_admin then
      raise exception 'La date du remboursement est obligatoire' using errcode = 'P0001';
    end if;
    v_date := now();
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

  -- 3. Doublon probable (seulement face à une AUTRE source).
  if v_status = 'counted' and not p_confirm_distinct then
    select r.* into v_dup
    from public.order_manual_refunds r
    where r.order_id = p_order_id
      and r.id is distinct from v_id
      and (v_existing.id is null or r.created_at < v_existing.created_at)
      and r.source <> p_source
      and r.status in ('counted', 'to_review')
      and v_ref is not null
      and lower(trim(r.reference)) = lower(v_ref)
    order by r.created_at
    limit 1;
    if found then
      v_status := 'duplicate';
      v_reason := 'Même référence qu''un remboursement déjà enregistré';
    else
      select r.* into v_dup
      from public.order_manual_refunds r
      where r.order_id = p_order_id
        and r.id is distinct from v_id
        and (v_existing.id is null or r.created_at < v_existing.created_at)
        and r.source <> p_source
        and r.status in ('counted', 'to_review')
        and r.amount = v_amount
        and abs(extract(epoch from (coalesce(r.refunded_at, r.created_at) - v_date))) <= 3 * 86400
      order by r.created_at
      limit 1;
      if found then
        v_status := 'to_review';
        v_reason := 'Doublon possible (même montant à ±3 jours)';
      end if;
    end if;
  end if;

  -- 4. Plafond : comptés + à vérifier (sans double réservation) ≤ encaissé.
  if v_status in ('counted', 'to_review') then
    v_reserved := public.refund_reserved_amount(p_order_id, v_id);
    v_own_reservation := case when v_status = 'to_review' and v_dup.id is not null
                              then greatest(v_amount - v_dup.amount, 0)
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
      v_dup := null;
    end if;
  end if;

  -- 5. Couverture par les décisions (saisie admin).
  if v_status = 'counted' and v_admin and not p_allow_gesture then
    select coalesce(sum(amount), 0) into v_decided
    from public.order_refund_decisions where order_id = p_order_id and voided_at is null;
    select coalesce(sum(amount), 0) into v_refunded
    from public.order_manual_refunds where order_id = p_order_id and status = 'counted' and id is distinct from v_id;
    if v_refunded + v_amount > v_decided + 0.004 then
      raise exception 'Le montant dépasse le reste à rembourser (CHF %). Cochez « geste commercial » pour enregistrer la différence.',
        to_char(greatest(v_decided - v_refunded, 0), 'FM999999990.00')
        using errcode = 'P0003';
    end if;
  end if;

  -- 6. Écriture.
  if v_id is null then
    insert into public.order_manual_refunds (
      order_id, amount, note, created_by, order_item_id,
      refunded_at, method, method_detail, reference, idempotency_key,
      source, source_ref, status, review_reason, duplicate_of
    ) values (
      p_order_id, greatest(coalesce(v_amount, 0), 0.01), nullif(trim(p_note), ''), p_created_by,
      case when cardinality(v_items) = 1 then v_items[1] else null end,
      v_date, p_method, nullif(trim(p_method_detail), ''), v_ref, p_idempotency_key,
      p_source, p_source_ref, v_status, v_reason, v_dup.id
    )
    returning id into v_id;
  else
    update public.order_manual_refunds
       set amount = greatest(coalesce(v_amount, 0), 0.01),
           refunded_at = v_date, reference = v_ref,
           note = coalesce(nullif(trim(p_note), ''), note),
           order_item_id = case when cardinality(v_items) = 1 then v_items[1] else null end,
           status = v_status, review_reason = v_reason, duplicate_of = v_dup.id,
           updated_at = now()
     where id = v_id;
    delete from public.order_manual_refund_items where order_manual_refund_items.refund_id = v_id;
  end if;

  if v_status <> 'rejected' then
    insert into public.order_manual_refund_items (refund_id, order_item_id)
    select v_id, i from unnest(v_items) i
    on conflict do nothing;
  end if;

  perform public.refresh_auto_refund_decision(v_id, p_created_by);

  return query select v_id, v_status, v_reason, v_created;
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
  update public.order_manual_refunds
     set status = 'voided', voided_at = now(), voided_by = p_by, void_reason = trim(p_reason), updated_at = now()
   where id = p_refund_id;
  perform public.refresh_auto_refund_decision(p_refund_id, p_by);
end;
$$;

-- ── Décisions ────────────────────────────────────────────────────────────
create or replace function public.record_refund_decision(
  p_order_id uuid,
  p_amount numeric,
  p_reason text,
  p_source text,
  p_idempotency_key text default null,
  p_item_ids uuid[] default null,
  p_by text default null,
  p_source_ref text default null,
  p_enforce_cap boolean default true
)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_id uuid;
  v_amount numeric := round(p_amount, 2);
  v_collected numeric;
  v_decided numeric;
begin
  if p_source not in ('admin_cancel', 'admin_gesture', 'make_cancel', 'workshop_cancel', 'legacy_due') then
    raise exception 'source de décision inconnue %', p_source using errcode = 'P0001';
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

  if p_enforce_cap then
    v_collected := public.order_collected_amount(p_order_id);
    select coalesce(sum(amount), 0) into v_decided
    from public.order_refund_decisions where order_id = p_order_id and voided_at is null;
    if v_decided + v_amount > v_collected + 0.004 then
      raise exception 'Le total décidé dépasserait le montant encaissé (CHF %). Maximum possible : CHF %.',
        to_char(v_collected, 'FM999999990.00'), to_char(greatest(v_collected - v_decided, 0), 'FM999999990.00')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, idempotency_key, decided_by)
  values (p_order_id, v_amount, nullif(trim(p_reason), ''), p_source, p_source_ref, p_idempotency_key, p_by)
  returning id into v_id;

  insert into public.order_refund_decision_items (decision_id, order_item_id)
  select v_id, i from unnest(coalesce(p_item_ids, '{}')) i
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function public.void_refund_decision(p_decision_id uuid, p_reason text, p_by text)
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_dec public.order_refund_decisions%rowtype;
  v_decided_after numeric;
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

  select coalesce(sum(amount), 0) into v_decided_after
  from public.order_refund_decisions
  where order_id = v_dec.order_id and voided_at is null and id <> p_decision_id;
  select coalesce(sum(amount), 0) into v_refunded
  from public.order_manual_refunds where order_id = v_dec.order_id and status = 'counted';
  if v_decided_after + 0.004 < v_refunded then
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
    'order_collected_amount(uuid)',
    'refund_reserved_amount(uuid, uuid)',
    'order_refund_summary(uuid)',
    'refresh_auto_refund_decision(uuid, text)',
    'ingest_refund(uuid, numeric, timestamptz, text, text, text, text, text, text, text, uuid[], text, boolean, boolean)',
    'review_refund(uuid, text, text)',
    'void_refund_entry(uuid, text, text)',
    'record_refund_decision(uuid, numeric, text, text, text, uuid[], text, text, boolean)',
    'void_refund_decision(uuid, text, text)',
    'set_order_test_flag(uuid, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
