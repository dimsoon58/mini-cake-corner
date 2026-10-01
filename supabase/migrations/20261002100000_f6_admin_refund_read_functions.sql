-- F6 — Lecture pour l'admin (lot 2) : fiche commande et section
-- « Remboursements » (Effectués / À effectuer / À vérifier).
--
-- Lecture seule, sauf resolve_refund_anomaly() qui marque une anomalie comme
-- vue. Ne touche ni le paiement, ni la production, ni le cashback, ni Make.
-- Additif, relançable. Nécessite F1–F5.
--
-- Commandes de test : toujours visibles sur leur propre fiche ; dans les
-- listes, exclues sauf p_include_tests = true (« Afficher les tests »).
-- Dates : jours calendaires Europe/Zurich. Un remboursement sans date réelle
-- (« à dater ») n'est jamais placé dans une période : il est renvoyé à part.

begin;

-- Origine affichée : manuelle (ORDM / source non « website ») ou site.
create or replace function public.order_origin(p_order_number text, p_order_source text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when coalesce(p_order_number, '') like 'ORDM-%' then 'manual'
    when p_order_source is not null and p_order_source <> 'website' then 'manual'
    else 'website'
  end;
$$;

-- Articles d'un remboursement / d'une décision, prêts à afficher.
create or replace function public.refund_items_json(p_item_ids uuid[])
returns jsonb
language sql
stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', oi.id, 'product', oi.product, 'size', oi.size, 'shape', oi.shape,
           'flavors', oi.flavors, 'total', oi.total, 'workshopDate', oi.workshop_date,
           'workshopType', oi.workshop_type, 'productionStatus', oi.production_status
         ) order by oi.created_at), '[]'::jsonb)
  from public.order_items oi
  where oi.id = any(coalesce(p_item_ids, '{}'));
$$;

-- ── Fiche commande ───────────────────────────────────────────────────────
create or replace function public.admin_order_refunds(p_order_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'orderNumber', o.order_number,
    'isTest', o.is_test,
    'origin', public.order_origin(o.order_number, o.order_source),
    'paidAt', o.paid_at,
    'summary', (select to_jsonb(s) from public.order_refund_summary(o.id) s),
    'cashback', jsonb_build_object(
      'target', o.cashback_refund_target,
      'real', o.cashback_refund_adjustment,
      'needsReview', o.cashback_needs_review),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount', r.amount, 'refundedAt', r.refunded_at, 'createdAt', r.created_at,
        'method', r.method, 'methodDetail', r.method_detail, 'reference', r.reference, 'note', r.note,
        'source', r.source, 'status', r.status, 'reviewReason', r.review_reason, 'duplicateOf', r.duplicate_of,
        'createdBy', r.created_by, 'reviewedAt', r.reviewed_at, 'reviewedBy', r.reviewed_by,
        'voidedAt', r.voided_at, 'voidedBy', r.voided_by, 'voidReason', r.void_reason,
        'items', public.refund_items_json(array(select i.order_item_id from public.order_manual_refund_items i where i.refund_id = r.id))
      ) order by coalesce(r.refunded_at, r.created_at) desc, r.created_at desc)
      from public.order_manual_refunds r where r.order_id = o.id), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'amount', d.amount, 'reason', d.reason, 'source', d.source, 'refundId', d.refund_id,
        'decidedAt', d.decided_at, 'decidedBy', d.decided_by,
        'voidedAt', d.voided_at, 'voidedBy', d.voided_by, 'voidReason', d.void_reason,
        'items', public.refund_items_json(array(select i.order_item_id from public.order_refund_decision_items i where i.decision_id = d.id))
      ) order by d.decided_at desc, d.created_at desc)
      from public.order_refund_decisions d where d.order_id = o.id), '[]'::jsonb),
    'anomalies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'source', a.source, 'requested', a.requested, 'recorded', a.recorded,
        'detail', a.detail, 'createdAt', a.created_at
      ) order by a.created_at desc)
      from public.refund_anomalies a where a.order_id = o.id and a.resolved_at is null), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- ── Section « Remboursements » ───────────────────────────────────────────
-- p_tab 'done'   : remboursements comptés datés dans [p_from ; p_to] (Zurich)
--                  + bloc « à dater » (toutes périodes) ; totaux séparés.
-- p_tab 'todo'   : commandes avec un reste à rembourser > 0 (photo du jour).
-- p_tab 'review' : remboursements « à vérifier » + anomalies non résolues.
create or replace function public.admin_refund_list(
  p_tab text,
  p_from date default null,
  p_to date default null,
  p_include_tests boolean default false
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_result jsonb;
begin
  if p_tab not in ('done', 'todo', 'review') then
    raise exception 'Onglet inconnu' using errcode = 'P0001';
  end if;

  if p_tab = 'done' then
    if p_from is null or p_to is null or p_to < p_from then
      raise exception 'Période invalide' using errcode = 'P0001';
    end if;
    with rows as (
      select r.*, o.order_number, o.order_source, o.first_name, o.last_name, o.is_test, o.paid_at, o.created_at as order_created_at
      from public.order_manual_refunds r
      join public.orders o on o.id = r.order_id
      where r.status = 'counted'
        and (p_include_tests or not o.is_test)
    ),
    item_rows as (
      select r.*, public.refund_items_json(array(select i.order_item_id from public.order_manual_refund_items i where i.refund_id = r.id)) as items
      from rows r
    ),
    dated as (
      select * from item_rows
      where refunded_at is not null
        and (refunded_at at time zone 'Europe/Zurich')::date between p_from and p_to
    ),
    undated as (select * from item_rows where refunded_at is null),
    to_json_rows as (
      select 'dated' as bucket, d.* from dated d
      union all
      select 'undated', u.* from undated u
    )
    select jsonb_build_object(
      'tab', 'done', 'from', p_from, 'to', p_to,
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'orderId', x.order_id, 'orderNumber', x.order_number,
          'customerName', trim(coalesce(x.first_name, '') || ' ' || coalesce(left(x.last_name, 1) || '.', '')),
          'origin', public.order_origin(x.order_number, x.order_source), 'isTest', x.is_test,
          'orderPaidAt', x.paid_at, 'amount', x.amount, 'refundedAt', x.refunded_at, 'createdAt', x.created_at,
          'method', x.method, 'methodDetail', x.method_detail, 'reference', x.reference, 'note', x.note,
          'source', x.source, 'items', x.items)
        order by x.refunded_at desc, x.created_at desc) from to_json_rows x where x.bucket = 'dated'), '[]'::jsonb),
      'total', (select coalesce(round(sum(amount), 2), 0) from dated),
      'count', (select count(*) from dated),
      'undated', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'orderId', x.order_id, 'orderNumber', x.order_number,
          'customerName', trim(coalesce(x.first_name, '') || ' ' || coalesce(left(x.last_name, 1) || '.', '')),
          'origin', public.order_origin(x.order_number, x.order_source), 'isTest', x.is_test,
          'amount', x.amount, 'createdAt', x.created_at, 'method', x.method, 'reference', x.reference,
          'note', x.note, 'source', x.source, 'items', x.items)
        order by x.created_at desc) from to_json_rows x where x.bucket = 'undated'), '[]'::jsonb),
      'undatedTotal', (select coalesce(round(sum(amount), 2), 0) from undated),
      'undatedCount', (select count(*) from undated)
    ) into v_result;

  elsif p_tab = 'todo' then
    with o as (
      select o.id, o.order_number, o.order_source, o.first_name, o.last_name, o.is_test, o.paid_at, s.*
      from public.orders o
      cross join lateral public.order_refund_summary(o.id) s
      where (p_include_tests or not o.is_test)
        and exists (select 1 from public.order_refund_decisions d where d.order_id = o.id and d.voided_at is null)
    ),
    todo as (select * from o where remaining > 0)
    select jsonb_build_object(
      'tab', 'todo',
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'orderId', t.id, 'orderNumber', t.order_number,
          'customerName', trim(coalesce(t.first_name, '') || ' ' || coalesce(left(t.last_name, 1) || '.', '')),
          'origin', public.order_origin(t.order_number, t.order_source), 'isTest', t.is_test,
          'collected', t.collected, 'decided', t.decided, 'refunded', t.refunded, 'remaining', t.remaining,
          'toReviewCount', t.to_review_count,
          'lastDecisionAt', (select max(d.decided_at) from public.order_refund_decisions d where d.order_id = t.id and d.voided_at is null),
          'reasons', (select coalesce(jsonb_agg(distinct d.reason), '[]'::jsonb) from public.order_refund_decisions d
                      where d.order_id = t.id and d.voided_at is null and d.reason is not null))
        order by t.order_number) from todo t), '[]'::jsonb),
      'total', (select coalesce(round(sum(remaining), 2), 0) from todo),
      'count', (select count(*) from todo)
    ) into v_result;

  else
    with rv as (
      select r.*, o.order_number, o.order_source, o.first_name, o.last_name, o.is_test,
             d.amount as dup_amount, d.source as dup_source, d.refunded_at as dup_refunded_at, d.created_at as dup_created_at
      from public.order_manual_refunds r
      join public.orders o on o.id = r.order_id
      left join public.order_manual_refunds d on d.id = r.duplicate_of
      where r.status = 'to_review' and (p_include_tests or not o.is_test)
    ),
    an as (
      select a.*, o.order_number, o.is_test
      from public.refund_anomalies a
      left join public.orders o on o.id = a.order_id
      where a.resolved_at is null and (p_include_tests or not coalesce(o.is_test, false))
    )
    select jsonb_build_object(
      'tab', 'review',
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'id', x.id, 'orderId', x.order_id, 'orderNumber', x.order_number,
          'customerName', trim(coalesce(x.first_name, '') || ' ' || coalesce(left(x.last_name, 1) || '.', '')),
          'origin', public.order_origin(x.order_number, x.order_source), 'isTest', x.is_test,
          'amount', x.amount, 'refundedAt', x.refunded_at, 'createdAt', x.created_at, 'source', x.source,
          'reference', x.reference, 'reviewReason', x.review_reason,
          'duplicateOf', case when x.duplicate_of is null then null else jsonb_build_object(
              'id', x.duplicate_of, 'amount', x.dup_amount, 'source', x.dup_source,
              'refundedAt', x.dup_refunded_at, 'createdAt', x.dup_created_at) end)
        order by x.created_at desc) from rv x), '[]'::jsonb),
      'amount', (select coalesce(round(sum(amount), 2), 0) from rv),
      'count', (select count(*) from rv),
      'anomalies', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'orderId', a.order_id, 'orderNumber', a.order_number, 'isTest', a.is_test,
          'kind', a.kind, 'source', a.source, 'requested', a.requested, 'recorded', a.recorded,
          'detail', a.detail, 'createdAt', a.created_at)
        order by a.created_at desc) from an a), '[]'::jsonb)
    ) into v_result;
  end if;

  return v_result;
end;
$$;

-- Marquer une anomalie comme vue / traitée (aucun autre effet).
create or replace function public.resolve_refund_anomaly(p_anomaly_id bigint, p_by text)
returns void
language plpgsql
set search_path to ''
as $$
begin
  update public.refund_anomalies
     set resolved_at = now(), resolved_by = p_by
   where id = p_anomaly_id and resolved_at is null;
  if not found and not exists (select 1 from public.refund_anomalies where id = p_anomaly_id) then
    raise exception 'Anomalie introuvable' using errcode = 'P0002';
  end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'order_origin(text, text)',
    'refund_items_json(uuid[])',
    'admin_order_refunds(uuid)',
    'admin_refund_list(text, date, date, boolean)',
    'resolve_refund_anomaly(bigint, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
