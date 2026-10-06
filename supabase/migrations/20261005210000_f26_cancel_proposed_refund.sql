-- F26 — Audit avant ouverture : annulation d'un article payé = montant proposé
-- à rembourser ; remboursement partiel sans décision correctement suivi.
--
-- À appliquer après F25. Ne rejoue aucune migration, ne modifie aucune donnée
-- existante (aucun rattrapage : toutes les commandes actuelles sont des tests).
-- Relançable. Aucune fonction Edge à redéployer.
--
-- Constats de l'audit du 05.10.2026 :
--   1. Un gâteau payé puis annulé (annulation complète ou d'un article) ne
--      créait aucun montant à rembourser : la fiche affichait « À rembourser 0 »,
--      la page Remboursements ne le listait pas, alors que la Compta et la
--      trésorerie le comptaient comme dû. Pour enregistrer le remboursement, il
--      fallait cocher « geste commercial ».
--   2. (régression F25) Un remboursement partiel enregistré sans décision créait
--      une décision automatique prise pour le montant décidé : 35 annulés,
--      20 remboursés → 0 restant dû au lieu de 15.
--
-- Corrections :
--   * Un article payé qui passe à « annulé » (article, commande entière, gâteau
--     refusé d'une commande encaissée) reçoit une décision « Annulation : montant
--     proposé automatiquement (ajustable) » = son prix (part des frais et remises
--     comprise), comme les workshops. Aucun e-mail, aucun mouvement d'argent.
--   * Ajuster : annuler cette proposition (motif obligatoire), puis décider le
--     montant voulu. Annulée sans nouvelle décision = rien à rembourser pour ces
--     articles ; l'écart apparaît en « Montant non remboursé » avec le motif.
--   * Une décision automatique née d'un remboursement n'est plus prise pour un
--     montant décidé (le prix de l'article reste dû jusqu'à son remboursement).
--
-- Fonctions :
--   public.refund_decisions_classified  (F25 recréée : + is_auto, propositions annulées à la main = 0)
--   public.sales_cancel_due             (F25 recréée : + covered, item_id ; sans décisions automatiques)
--   public.admin_order_refunds          (F25 remplacée : motifs sans décisions automatiques)
--   public.sync_cancel_decision         (nouvelle) + déclencheurs sur order_items et orders

begin;

drop function if exists public.sales_cancel_due(boolean, date);
drop function if exists public.refund_decisions_classified(boolean, date);

create function public.refund_decisions_classified(p_include_tests boolean default false, p_date date default null)
returns table (decision_id uuid, order_id uuid, amount numeric, reason text, is_gesture boolean, covers_all boolean, covered_items uuid[], is_auto boolean)
language sql
stable
set search_path to ''
as $$
  with
  sl as (select * from public.sales_lines(p_include_tests)),
  off_items as (select distinct l.order_id, l.item_id from sl l where l.state in ('cancelled', 'refused') and l.item_id is not null),
  d as (
    -- F26 : une proposition d'annulation (admin_cancel / workshop_cancel) annulée À LA MAIN
    -- vaut « 0 à rembourser » pour ses articles, avec le motif de l'annulation.
    select d.id, d.order_id,
           case when d.voided_at is null then d.amount else 0 end as amount,
           case when d.voided_at is null then d.reason else coalesce(nullif(trim(d.void_reason), ''), d.reason) end as reason,
           d.source,
           case when d.source = 'auto_from_refund'
                then array(select ri.order_item_id from public.order_manual_refund_items ri where ri.refund_id = d.refund_id)
                else array(select di.order_item_id from public.order_refund_decision_items di where di.decision_id = d.id)
           end as items
    from public.order_refund_decisions d
    where (d.voided_at is null
           or (d.source in ('admin_cancel', 'workshop_cancel') and coalesce(d.voided_by, 'system') <> 'system'))
      and d.order_id in (select l.order_id from sl l)
      and (p_date is null or (d.decided_at at time zone 'Europe/Zurich')::date <= p_date)
  ),
  x as (
    select d.*,
           array(select i from unnest(d.items) i where exists (select 1 from off_items o where o.order_id = d.order_id and o.item_id = i)) as off_hit,
           exists (select 1 from off_items o where o.order_id = d.order_id) as has_off,
           exists (select 1 from sl l where l.order_id = d.order_id and l.state = 'kept') as has_kept
    from d
  )
  select x.id, x.order_id, x.amount, x.reason,
         case
           when x.source = 'admin_gesture' then not (cardinality(x.off_hit) > 0 or (cardinality(x.items) = 0 and x.has_off and not x.has_kept))
           when x.source = 'auto_from_refund' then cardinality(x.items) > 0 and cardinality(x.off_hit) = 0
           else false
         end,
         cardinality(x.off_hit) = 0
           or not exists (select 1 from off_items o where o.order_id = x.order_id and not (o.item_id = any (x.off_hit))),
         x.off_hit,
         x.source = 'auto_from_refund'
  from x;
$$;

create function public.sales_cancel_due(p_include_tests boolean default false, p_date date default null)
returns table (order_id uuid, seq bigint, amount numeric, due numeric, not_refunded numeric, covered boolean, item_id uuid)
language sql
stable
set search_path to ''
as $$
  with
  sl as (select * from public.sales_lines(p_include_tests)),
  -- F26 : une décision automatique (créée par un remboursement fait sans décision) n'est pas un montant décidé.
  dec as (select * from public.refund_decisions_classified(p_include_tests, p_date) where not is_gesture and not is_auto),
  off as (
    select l.order_id, l.seq, l.amount, l.item_id,
           exists (select 1 from dec d where d.order_id = l.order_id and (d.covers_all or l.item_id = any (d.covered_items))) as covered
    from sl l
    where l.state in ('cancelled', 'refused')
  ),
  cov as (select d.order_id, sum(d.amount) as dec_amount from dec d group by d.order_id),
  w as (
    select o.*, coalesce(c.dec_amount, 0) as dec_amount,
           case when o.covered then greatest(o.amount, 0) else 0 end as cw,
           case when o.covered then 1 else 0 end as cn
    from off o left join cov c on c.order_id = o.order_id
  ),
  w2 as (
    select w.*,
           sum(w.cw) over (partition by w.order_id order by w.seq) as ccum, sum(w.cw) over (partition by w.order_id) as ctot,
           sum(w.cn) over (partition by w.order_id order by w.seq) as ncum, sum(w.cn) over (partition by w.order_id) as ntot
    from w
  ),
  r as (
    select w2.order_id, w2.seq, w2.amount, w2.covered, w2.item_id,
           case when not w2.covered then w2.amount
                when w2.ctot > 0 then round(w2.dec_amount * w2.ccum / w2.ctot, 2) - round(w2.dec_amount * (w2.ccum - w2.cw) / w2.ctot, 2)
                else round(w2.dec_amount * w2.ncum / w2.ntot, 2) - round(w2.dec_amount * (w2.ncum - 1) / w2.ntot, 2)
           end as due
    from w2
  )
  select r.order_id, r.seq, r.amount, r.due, greatest(r.amount - r.due, 0), r.covered, r.item_id from r;
$$;

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
    -- F25 : écart entre le prix des articles annulés et le montant décidé, et ses motifs.
    'notRefunded', (select coalesce(round(sum(c.not_refunded), 2), 0) from public.sales_cancel_due(true, null) c where c.order_id = o.id),
    'notRefundedReasons', coalesce((select jsonb_agg(distinct d.reason) from public.refund_decisions_classified(true, null) d
                                    where d.order_id = o.id and not d.is_gesture and not d.is_auto and d.reason is not null), '[]'::jsonb),
    'cancelledItemIds', coalesce((select jsonb_agg(distinct l.item_id) from public.sales_lines(true) l
                                  where l.order_id = o.id and l.state in ('cancelled', 'refused') and l.item_id is not null), '[]'::jsonb),
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

-- ── Proposition de remboursement à l'annulation d'un article payé ─────────
-- Montant = articles annulés pas encore couverts par une décision (prix de
-- chaque ligne, part des frais et remises comprise). Une seule proposition par
-- ensemble d'articles (source_ref), jamais recréée si elle a été annulée.
create or replace function public.sync_cancel_decision(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_amount numeric;
  v_items uuid[];
  v_no_item boolean;
  v_ref text;
begin
  if coalesce(public.order_collected_amount(p_order_id), 0) <= 0 then return null; end if;
  select round(sum(c.due), 2),
         array(select distinct x.item_id from public.sales_cancel_due(true, null) x
               where x.order_id = p_order_id and not x.covered and x.item_id is not null order by 1),
         bool_or(c.item_id is null)
    into v_amount, v_items, v_no_item
  from public.sales_cancel_due(true, null) c
  where c.order_id = p_order_id and not c.covered;
  if coalesce(v_amount, 0) <= 0 then return null; end if;
  -- Une ligne sans article (frais de livraison d'une commande annulée) : la proposition vaut pour toute la commande.
  if v_no_item then v_items := null; end if;
  v_ref := p_order_id::text || ':' || md5(coalesce(array_to_string(v_items, ','), 'commande'));
  return public.record_refund_decision(
    p_order_id    => p_order_id,
    p_amount      => v_amount,
    p_reason      => 'Annulation : montant proposé automatiquement (ajustable)',
    p_source      => 'admin_cancel',
    p_item_ids    => v_items,
    p_by          => 'system',
    p_source_ref  => v_ref,
    p_on_excess   => 'clamp');
end;
$$;

-- Déclencheurs : n'empêchent JAMAIS l'annulation (erreur notée dans refund_ingest_errors).
create or replace function public.trg_cancel_decision()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  begin
    perform public.sync_cancel_decision(new.order_id);
  exception when others then
    insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
    values ('admin_cancel', new.id::text, new.order_id, sqlerrm, to_jsonb(new));
  end;
  return null;
end;
$$;

create or replace function public.trg_cancel_decision_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  begin
    perform public.sync_cancel_decision(new.id);
  exception when others then
    insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
    values ('admin_cancel', new.id::text, new.id, sqlerrm, jsonb_build_object('order_validation', new.order_validation, 'physical_validation', new.physical_validation));
  end;
  return null;
end;
$$;

drop trigger if exists trg_cancel_decision on public.order_items;
create trigger trg_cancel_decision
  after update of production_status on public.order_items
  for each row
  when (new.production_status::text = 'cancelled' and old.production_status::text is distinct from 'cancelled')
  execute function public.trg_cancel_decision();

drop trigger if exists trg_cancel_decision_order on public.orders;
create trigger trg_cancel_decision_order
  after update of order_validation, physical_validation on public.orders
  for each row
  when ((new.order_validation::text = 'cancelled' and old.order_validation::text is distinct from 'cancelled')
     or (new.physical_validation::text = 'rejected' and old.physical_validation::text is distinct from 'rejected'))
  execute function public.trg_cancel_decision_order();

do $$
declare f text;
begin
  foreach f in array array[
    'refund_decisions_classified(boolean, date)',
    'sales_cancel_due(boolean, date)',
    'admin_order_refunds(uuid)',
    'sync_cancel_decision(uuid)',
    'trg_cancel_decision()',
    'trg_cancel_decision_order()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

commit;
