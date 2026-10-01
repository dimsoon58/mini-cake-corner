-- F7 — Chiffres financiers du mois (lot 3) : dashboard + export Excel.
--
-- Lecture seule. Additive, relançable. Nécessite F1–F6.
--
-- Règles (plan v3.1, décisions D1 / D6 / D7) :
--   Encaissé       = commandes dont la date RÉELLE d'encaissement (paid_at)
--                    tombe dans le mois (Europe/Zurich) ; montant = paid_amount
--                    (commandes manuelles) sinon total_amount.
--   Remboursé      = remboursements COMPTÉS dont la date réelle (refunded_at)
--                    tombe dans le mois, quelle que soit la date de la commande.
--   Net            = Encaissé − Remboursé du mois.
--   À encaisser    = photo du jour : commandes confirmées non payées
--                    (manuelles non brouillon ; site acceptées non encaissées).
--                    Paniers abandonnés et brouillons exclus.
--   Reste à rembourser = photo du jour : Σ (décidé − remboursé) > 0.
--   À dater        = remboursements comptés sans date réelle : jamais dans un
--                    mois, montrés à part.
--   À vérifier     = remboursements « to_review » : jamais comptés.
--   Commandes de test exclues partout, sauf p_include_tests = true.
-- Détail « Commandes et articles » : une ligne par article des commandes
-- encaissées dans le mois + une ligne « Ajustements de la commande » (frais,
-- remises, cagnotte, ajustement manuel…) = encaissé − Σ articles, pour que la
-- somme des lignes d'une commande soit exactement son encaissé. Le total de la
-- commande n'est jamais répété sur chaque article.

begin;

create or replace function public.admin_finance_month(p_month date, p_include_tests boolean default false)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if p_month is null then
    raise exception 'Mois obligatoire' using errcode = 'P0001';
  end if;

  with
  ord as (
    select o.*,
           public.order_origin(o.order_number, o.order_source) as origin,
           trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')) as customer,
           round(coalesce(o.paid_amount, o.total_amount), 2) as collected_amount
    from public.orders o
    where p_include_tests or not o.is_test
  ),
  collected as (
    select * from ord
    where paid_at is not null
      and (paid_at at time zone 'Europe/Zurich')::date between v_from and v_to
  ),
  refunds as (
    select r.*, o.order_number, o.origin, o.customer, o.paid_at as order_paid_at,
           public.refund_items_json(array(select i.order_item_id from public.order_manual_refund_items i where i.refund_id = r.id)) as items
    from public.order_manual_refunds r
    join ord o on o.id = r.order_id
    where r.status = 'counted'
  ),
  refunds_month as (
    select * from refunds
    where refunded_at is not null
      and (refunded_at at time zone 'Europe/Zurich')::date between v_from and v_to
  ),
  refunds_undated as (select * from refunds where refunded_at is null),
  to_review as (
    select r.* from public.order_manual_refunds r join ord o on o.id = r.order_id where r.status = 'to_review'
  ),
  to_collect as (
    select * from ord
    where payment_status::text = 'pending'
      and order_failure_reason is null
      and order_validation::text not in ('cancelled', 'rejected')
      and (
        (origin = 'manual' and not coalesce(is_draft, false))
        or (origin = 'website' and order_validation::text = 'approved')
      )
  ),
  remaining as (
    select o.id, o.order_number, o.origin, o.customer, s.remaining
    from ord o
    cross join lateral public.order_refund_summary(o.id) s
    where exists (select 1 from public.order_refund_decisions d where d.order_id = o.id and d.voided_at is null)
      and s.remaining > 0
  ),
  item_lines as (
    select c.id as order_id, c.order_number, c.origin, c.customer, c.paid_at,
           'item'::text as line_type, oi.id as item_id, oi.product::text as product, oi.size, oi.shape, oi.flavors,
           coalesce(oi.quantity, 1) as quantity, oi.workshop_type, oi.workshop_participants,
           coalesce(oi.workshop_date, f.pickup_delivery_date, c.pickup_delivery_date) as service_date,
           oi.production_status::text as production_status,
           round(coalesce(oi.total, 0), 2) as amount, oi.created_at as sort_at
    from collected c
    join public.order_items oi on oi.order_id = c.id
    left join public.order_fulfillments f on f.id = oi.fulfillment_id
  ),
  adjust_lines as (
    select c.id as order_id, c.order_number, c.origin, c.customer, c.paid_at,
           'adjustment'::text as line_type, null::uuid as item_id, null::text as product, null::text as size, null::text as shape,
           null::text[] as flavors, null::integer as quantity, null::text as workshop_type, null::integer as workshop_participants,
           null::date as service_date, null::text as production_status,
           round(c.collected_amount - coalesce((select sum(oi.total) from public.order_items oi where oi.order_id = c.id), 0), 2) as amount,
           'infinity'::timestamptz as sort_at,
           jsonb_build_object(
             'deliveryFee', c.delivery_fee, 'expressSurcharge', c.express_surcharge_amount,
             'welcomeDiscount', c.welcome_discount_amount, 'partnerDiscount', c.partner_discount_amount,
             'rewardUsed', c.reward_amount_used, 'priceAdjustment', c.price_adjustment_amount) as detail
    from collected c
  )
  select jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to, 'includeTests', p_include_tests,
    'cards', jsonb_build_object(
      'collected', (select coalesce(round(sum(collected_amount), 2), 0) from collected),
      'collectedCount', (select count(*) from collected),
      'refunded', (select coalesce(round(sum(amount), 2), 0) from refunds_month),
      'refundedCount', (select count(*) from refunds_month),
      'net', (select coalesce(round(sum(collected_amount), 2), 0) from collected)
             - (select coalesce(round(sum(amount), 2), 0) from refunds_month),
      'toCollect', (select coalesce(round(sum(total_amount), 2), 0) from to_collect),
      'toCollectCount', (select count(*) from to_collect),
      'remainingToRefund', (select coalesce(round(sum(remaining), 2), 0) from remaining),
      'remainingCount', (select count(*) from remaining),
      'undated', (select coalesce(round(sum(amount), 2), 0) from refunds_undated),
      'undatedCount', (select count(*) from refunds_undated),
      'toReview', (select coalesce(round(sum(amount), 2), 0) from to_review),
      'toReviewCount', (select count(*) from to_review),
      'byOrigin', jsonb_build_object(
        'website', jsonb_build_object(
          'collected', (select coalesce(round(sum(collected_amount), 2), 0) from collected where origin = 'website'),
          'count', (select count(*) from collected where origin = 'website')),
        'manual', jsonb_build_object(
          'collected', (select coalesce(round(sum(collected_amount), 2), 0) from collected where origin = 'manual'),
          'count', (select count(*) from collected where origin = 'manual')))
    ),
    'collections', coalesce((select jsonb_agg(jsonb_build_object(
        'orderId', c.id, 'orderNumber', c.order_number, 'origin', c.origin, 'customer', c.customer,
        'isTest', c.is_test, 'paidAt', c.paid_at, 'paymentMethod', c.payment_method, 'amount', c.collected_amount)
      order by c.paid_at, c.order_number) from collected c), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'orderId', r.order_id, 'orderNumber', r.order_number, 'origin', r.origin, 'customer', r.customer,
        'orderPaidAt', r.order_paid_at, 'refundedAt', r.refunded_at, 'amount', r.amount, 'method', r.method,
        'methodDetail', r.method_detail, 'reference', r.reference, 'note', r.note, 'source', r.source, 'items', r.items)
      order by r.refunded_at, r.created_at) from refunds_month r), '[]'::jsonb),
    'undatedRefunds', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'orderId', r.order_id, 'orderNumber', r.order_number, 'origin', r.origin, 'customer', r.customer,
        'orderPaidAt', r.order_paid_at, 'createdAt', r.created_at, 'amount', r.amount, 'method', r.method,
        'methodDetail', r.method_detail, 'reference', r.reference, 'note', r.note, 'source', r.source, 'items', r.items)
      order by r.created_at) from refunds_undated r), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'orderId', l.order_id, 'orderNumber', l.order_number, 'origin', l.origin, 'customer', l.customer, 'paidAt', l.paid_at,
        'lineType', l.line_type, 'itemId', l.item_id, 'product', l.product, 'size', l.size, 'shape', l.shape,
        'flavors', l.flavors, 'quantity', l.quantity, 'workshopType', l.workshop_type, 'participants', l.workshop_participants,
        'serviceDate', l.service_date, 'productionStatus', l.production_status, 'amount', l.amount, 'detail', l.detail)
      order by l.paid_at, l.order_number, l.sort_at)
      from (
        select item_lines.*, null::jsonb as detail from item_lines
        union all
        select * from adjust_lines where amount <> 0
      ) l), '[]'::jsonb),
    'toCollectList', coalesce((select jsonb_agg(jsonb_build_object(
        'orderId', t.id, 'orderNumber', t.order_number, 'origin', t.origin, 'customer', t.customer,
        'isTest', t.is_test, 'amount', t.total_amount, 'createdAt', t.created_at)
      order by t.created_at) from to_collect t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_finance_month(date, boolean) from public, anon, authenticated;
grant execute on function public.admin_finance_month(date, boolean) to service_role;

commit;
