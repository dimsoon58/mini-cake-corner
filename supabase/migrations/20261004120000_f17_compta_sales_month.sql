-- F17 — Compta : ventes du mois de RÉALISATION (décision du 2026-10-04).
--
-- À appliquer après F16. Ne rejoue aucune migration. Additive, relançable :
-- une nouvelle fonction (admin_sales_month) et le remplacement de
-- settlement_month_figures (F13) pour que le décompte Mel / Eli parte des
-- ventes du mois. admin_finance_month (F7, encaissements par date de
-- paiement, tableau de bord) n'est PAS modifiée.
--
-- Règles :
--   * Chaque article est rattaché au mois de SA date : retrait / livraison de
--     sa date de commande (order_items.fulfillment_id), sinon la date de la
--     commande ; un workshop au mois de sa séance. La date de paiement ne
--     compte pas.
--   * Ventes retenues : commandes manuelles confirmées (non brouillon) et
--     commandes du site acceptées. Commandes à accepter, refusées, en échec,
--     brouillons et commandes de test : non comptées.
--   * Montant de la commande = paid_amount (manuelles) sinon total_amount, comme
--     F7. Frais et remises répartis SANS dupliquer le total :
--       - livraison : frais de chaque date (order_fulfillments.delivery_fee)
--         au mois de cette date ; sinon une ligne « Livraison » au mois du
--         premier article livré ;
--       - le reste (supplément express, bienvenue, remise partenaire,
--         cagnotte, ajustement manuel, écart payé/total) au prorata des
--         articles physiques (de tous les articles s'il n'y en a pas), au
--         centime, le dernier article prenant l'arrondi ;
--       la somme des lignes d'une commande = son montant, tous mois confondus.
--   * Une ligne par gâteau : un article en quantité 2 donne 2 lignes.
--   * Articles annulés : commande annulée, article annulé (production_status
--     'cancelled' ou remboursement « annule l'article »), places de workshop
--     annulées (au prorata des places). Ils sont montrés à part et retirés
--     des ventes. Gâteau refusé d'une commande mixte : jamais une vente.
--   * Remboursements (comptés, toutes dates) : la part qui correspond à des
--     articles annulés / refusés est un « remboursement d'annulation », déjà
--     retiré par l'annulation (jamais déduit une 2e fois) ; le surplus est un
--     « geste commercial », déduit des ventes au prorata des articles
--     maintenus de la commande, chacun dans son mois.
--   * Ventes maintenues = ventes − articles annulés − gestes commerciaux.
--   * Restant à payer = articles maintenus du mois dont la commande n'est pas
--     encore payée (commandes manuelles « en attente de paiement »).

begin;

create or replace function public.admin_sales_month(p_month date, p_include_tests boolean default false)
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
           round(coalesce(o.paid_amount, o.total_amount), 2) as sale_amount
    from public.orders o
    where (p_include_tests or not o.is_test)
      and not coalesce(o.is_draft, false)
      and o.order_failure_reason is null
      and o.order_validation::text <> 'rejected'
  ),
  sold as (
    select * from ord
    where origin = 'manual'
       or physical_validation::text in ('approved', 'rejected')
       or (physical_validation::text = 'not_applicable' and order_validation::text in ('approved', 'cancelled'))
  ),
  awaiting as (
    select * from ord
    where origin = 'website' and id not in (select id from sold)
      and order_validation::text not in ('cancelled')
      and payment_status::text in ('pending', 'paid')
  ),
  it as (
    select s.id as order_id, oi.id as item_id, oi.product::text as product, oi.size, oi.shape, oi.flavors, oi.design,
           greatest(coalesce(oi.quantity, 1), 1) as qty, round(coalesce(oi.total, 0), 2) as base,
           oi.workshop_type, oi.workshop_participants, oi.fulfillment_id, oi.created_at,
           coalesce(oi.workshop_date, f.pickup_delivery_date, s.pickup_delivery_date) as service_date,
           case
             when s.order_validation::text = 'cancelled' then 'order_cancelled'
             when oi.production_status::text = 'cancelled' then 'item_cancelled'
             when exists (select 1 from public.order_manual_refunds m
                          where m.order_item_id = oi.id and m.cancels_item and m.status not in ('voided', 'rejected', 'duplicate')) then 'item_cancelled'
             when oi.product::text <> 'workshop' and s.physical_validation::text = 'rejected' then 'refused'
           end as cancel_reason,
           r.purchased_seats, r.cancelled_seats, r.status as res_status
    from sold s
    join public.order_items oi on oi.order_id = s.id
    left join public.order_fulfillments f on f.id = oi.fulfillment_id
    left join lateral (select wr.purchased_seats, wr.cancelled_seats, wr.status from public.workshop_reservations wr
                       where wr.order_item_id = oi.id order by wr.created_at limit 1) r on true
  ),
  -- Totaux par commande : frais de livraison (par date si cohérents) et reste à répartir.
  ototal as (
    select s.id as order_id, s.sale_amount, s.delivery_fee, s.pickup_delivery_date,
           coalesce((select sum(base) from it where it.order_id = s.id), 0) as items_sum,
           coalesce((select sum(f.delivery_fee) from public.order_fulfillments f where f.order_id = s.id), 0) as f_fees,
           exists (select 1 from it where it.order_id = s.id and it.product <> 'workshop') as has_physical
    from sold s
  ),
  oadj as (
    select t.*,
           (t.f_fees > 0 and abs(t.f_fees - coalesce(t.delivery_fee, 0)) < 0.005) as fees_by_date,
           round(t.sale_amount - t.items_sum - coalesce(t.delivery_fee, 0), 2) as rest
    from ototal t
  ),
  -- Répartition du reste au prorata (au centime, cumulatif) sur les articles éligibles.
  elig as (
    select it.*, a.rest,
           case when a.has_physical then it.product <> 'workshop' else true end as eligible
    from it join oadj a on a.order_id = it.order_id
  ),
  weighted as (
    select e.*,
           case when e.eligible then (case when sum(case when e.eligible then e.base else 0 end) over (partition by e.order_id) > 0 then e.base else 1 end) else 0 end as w
    from elig e
  ),
  cum as (
    select w0.*,
           sum(w0.w) over (partition by w0.order_id order by w0.created_at, w0.item_id rows between unbounded preceding and current row) as cw,
           sum(w0.w) over (partition by w0.order_id) as tw
    from weighted w0
  ),
  items_adj as (
    select c.*,
           case when c.w = 0 or c.tw = 0 then 0
                else round(c.rest * c.cw / c.tw, 2) - round(c.rest * (c.cw - c.w) / c.tw, 2) end as adj
    from cum c
  ),
  -- Une ligne par gâteau (quantité > 1 → plusieurs lignes), montant réparti au centime.
  units as (
    select ia.*, k.k as unit_index,
           case when ia.product = 'workshop' then 1 else ia.qty end as unit_count
    from items_adj ia
    cross join lateral generate_series(1, case when ia.product = 'workshop' then 1 else ia.qty end) as k(k)
  ),
  unit_lines as (
    select u.*,
           round(u.base * u.unit_index / u.unit_count, 2) - round(u.base * (u.unit_index - 1) / u.unit_count, 2) as u_base,
           round(u.adj * u.unit_index / u.unit_count, 2) - round(u.adj * (u.unit_index - 1) / u.unit_count, 2) as u_adj
    from units u
  ),
  -- Workshops : part maintenue (places actives) et part annulée (places annulées).
  item_lines as (
    select ul.order_id, ul.item_id, ul.fulfillment_id, 'item'::text as kind, ul.product, ul.size, ul.shape, ul.flavors, ul.design,
           ul.workshop_type, ul.unit_index, ul.unit_count, ul.service_date, ul.created_at,
           case when ul.cancel_reason = 'refused' then 'refused' when ul.cancel_reason is not null then 'cancelled' else 'kept' end as state,
           ul.cancel_reason as reason, ul.u_base as base, ul.u_adj as adj, ul.u_base + ul.u_adj as amount,
           null::integer as seats
    from unit_lines ul
    where ul.product <> 'workshop' or ul.cancel_reason is not null
    union all
    select ul.order_id, ul.item_id, ul.fulfillment_id, 'item', ul.product, ul.size, ul.shape, ul.flavors, ul.design,
           ul.workshop_type, 1, 1, ul.service_date, ul.created_at, p.state, p.reason,
           p.part_base, p.part_adj, p.part_base + p.part_adj, p.seats
    from unit_lines ul
    cross join lateral (
      select x.frac,
             greatest(coalesce(ul.purchased_seats, ul.workshop_participants, 1), 1) as total_seats
      from (select case
                     when ul.res_status in ('cancelled', 'rejected') then 0::numeric
                     when coalesce(ul.purchased_seats, 0) > 0 then (ul.purchased_seats - ul.cancelled_seats)::numeric / ul.purchased_seats
                     else 1::numeric end as frac) x
    ) s
    cross join lateral (
      select 'kept'::text as state, null::text as reason, round(ul.u_base * s.frac, 2) as part_base, round(ul.u_adj * s.frac, 2) as part_adj,
             round(s.total_seats * s.frac)::integer as seats
      where s.frac > 0
      union all
      select 'cancelled', 'seats_cancelled', ul.u_base - round(ul.u_base * s.frac, 2), ul.u_adj - round(ul.u_adj * s.frac, 2),
             s.total_seats - round(s.total_seats * s.frac)::integer
      where s.frac < 1
    ) p
    where ul.product = 'workshop' and ul.cancel_reason is null
  ),
  -- Frais de livraison : par date de livraison, sinon une ligne au mois du premier article physique.
  delivery_lines as (
    select a.order_id, null::uuid as item_id, f.id as fulfillment_id, 'delivery'::text as kind, null::text as product,
           null::text as size, null::text as shape, null::text[] as flavors, null::text as design, null::text as workshop_type,
           1 as unit_index, 1 as unit_count, f.pickup_delivery_date as service_date, 'infinity'::timestamptz as created_at,
           case when exists (select 1 from it where it.order_id = a.order_id and it.fulfillment_id = f.id and it.product <> 'workshop' and it.cancel_reason is null)
                  or not exists (select 1 from it where it.order_id = a.order_id and it.fulfillment_id = f.id and it.product <> 'workshop')
                then 'kept' else 'cancelled' end as state,
           null::text as reason, round(f.delivery_fee, 2) as base, 0::numeric as adj, round(f.delivery_fee, 2) as amount, null::integer as seats
    from oadj a
    join public.order_fulfillments f on f.order_id = a.order_id
    where a.fees_by_date and f.delivery_fee <> 0
    union all
    select a.order_id, null, null, 'delivery', null, null, null, null, null, null, 1, 1,
           coalesce((select min(it.service_date) from it where it.order_id = a.order_id and it.product <> 'workshop'), a.pickup_delivery_date),
           'infinity'::timestamptz,
           case when exists (select 1 from it where it.order_id = a.order_id and it.product <> 'workshop' and it.cancel_reason is null)
                  or not exists (select 1 from it where it.order_id = a.order_id and it.product <> 'workshop')
                then 'kept' else 'cancelled' end,
           null, round(a.delivery_fee, 2), 0, round(a.delivery_fee, 2), null
    from oadj a
    where not a.fees_by_date and coalesce(a.delivery_fee, 0) <> 0
  ),
  all_lines as (
    select l.*, row_number() over (partition by l.order_id order by l.service_date nulls last, l.created_at, l.item_id, l.unit_index, l.state) as seq
    from (select * from item_lines union all select * from delivery_lines) l
  ),
  -- Remboursements comptés (toutes dates) : d'annulation d'abord, le surplus = geste commercial.
  orefund as (
    select s.id as order_id,
           coalesce((select sum(m.amount) from public.order_manual_refunds m where m.order_id = s.id and m.status = 'counted'), 0) as refunded,
           coalesce((select sum(l.amount) from all_lines l where l.order_id = s.id and l.state in ('cancelled', 'refused')), 0) as cancelled_value
    from sold s
  ),
  osplit as (
    select r.*, least(r.refunded, r.cancelled_value) as cancel_refund, greatest(r.refunded - r.cancelled_value, 0) as gesture,
           exists (select 1 from all_lines l where l.order_id = r.order_id and l.state = 'kept') as has_kept
    from orefund r
  ),
  lines_w as (
    select l.*, o.cancel_refund, o.gesture,
           case when l.state = 'kept' or not o.has_kept then greatest(l.amount, 0) else 0 end as gw,
           case when l.state in ('cancelled', 'refused') then greatest(l.amount, 0) else 0 end as cw0
    from all_lines l join osplit o on o.order_id = l.order_id
  ),
  lines_c as (
    select x.*,
           sum(x.gw) over (partition by x.order_id order by x.seq) as gcum, sum(x.gw) over (partition by x.order_id) as gtot,
           sum(x.cw0) over (partition by x.order_id order by x.seq) as ccum, sum(x.cw0) over (partition by x.order_id) as ctot
    from lines_w x
  ),
  lines_final as (
    select c.*,
           case when c.gtot = 0 or c.gw = 0 then 0 else round(c.gesture * c.gcum / c.gtot, 2) - round(c.gesture * (c.gcum - c.gw) / c.gtot, 2) end as gesture_part,
           case when c.ctot = 0 or c.cw0 = 0 then 0 else round(c.cancel_refund * c.ccum / c.ctot, 2) - round(c.cancel_refund * (c.ccum - c.cw0) / c.ctot, 2) end as cancel_refund_part
    from lines_c c
  ),
  month_lines as (
    select l.*, s.order_number, s.origin, s.customer, s.is_test, s.payment_status::text as payment_status, s.paid_at,
           s.order_validation::text as order_validation, s.created_via
    from lines_final l join sold s on s.id = l.order_id
    where l.service_date between v_from and v_to
  ),
  undated as (
    select l.*, s.order_number, s.customer from lines_final l join sold s on s.id = l.order_id where l.service_date is null
  )
  select jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'), 'from', v_from, 'to', v_to, 'includeTests', p_include_tests,
    'cards', jsonb_build_object(
      'gross', (select coalesce(round(sum(amount), 2), 0) from month_lines where state in ('kept', 'cancelled')),
      'cancelled', (select coalesce(round(sum(amount), 2), 0) from month_lines where state = 'cancelled'),
      'cancelledCount', (select count(*) from month_lines where state = 'cancelled'),
      'kept', (select coalesce(round(sum(amount), 2), 0) from month_lines where state = 'kept'),
      'gestures', (select coalesce(round(sum(gesture_part), 2), 0) from month_lines),
      'net', (select coalesce(round(sum(amount), 2), 0) from month_lines where state = 'kept')
             - (select coalesce(round(sum(gesture_part), 2), 0) from month_lines),
      'cancellationRefunds', (select coalesce(round(sum(cancel_refund_part), 2), 0) from month_lines),
      'cancellationsToRefund', (select coalesce(round(sum(amount - cancel_refund_part), 2), 0) from month_lines
                                where state = 'cancelled' and payment_status in ('paid', 'refunded')),
      'toCollect', (select coalesce(round(sum(amount - gesture_part), 2), 0) from month_lines where state = 'kept' and payment_status = 'pending'),
      'toCollectOrders', (select count(distinct order_id) from month_lines where state = 'kept' and payment_status = 'pending'),
      'orders', (select count(distinct order_id) from month_lines where state = 'kept'),
      'cakes', (select count(*) from month_lines where state = 'kept' and kind = 'item' and product <> 'workshop'),
      'workshopSeats', (select coalesce(sum(seats), 0) from month_lines where state = 'kept' and product = 'workshop'),
      'refusedCount', (select count(*) from month_lines where state = 'refused'),
      'toAcceptCount', (select count(*) from awaiting a
                        where exists (select 1 from public.order_items oi left join public.order_fulfillments f on f.id = oi.fulfillment_id
                                      where oi.order_id = a.id
                                        and coalesce(oi.workshop_date, f.pickup_delivery_date, a.pickup_delivery_date) between v_from and v_to)),
      'undatedCount', (select count(*) from undated),
      'undatedAmount', (select coalesce(round(sum(amount), 2), 0) from undated)
    ),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'orderId', l.order_id, 'orderNumber', l.order_number, 'origin', l.origin, 'customer', l.customer, 'isTest', l.is_test,
        'paymentStatus', l.payment_status, 'paidAt', l.paid_at, 'orderValidation', l.order_validation,
        'kind', l.kind, 'itemId', l.item_id, 'product', l.product, 'size', l.size, 'shape', l.shape, 'flavors', l.flavors, 'design', l.design,
        'workshopType', l.workshop_type, 'seats', l.seats, 'unitIndex', l.unit_index, 'unitCount', l.unit_count,
        'serviceDate', l.service_date, 'state', l.state, 'reason', l.reason,
        'base', l.base, 'adjustment', l.adj, 'amount', l.amount,
        'gesture', l.gesture_part, 'cancellationRefund', l.cancel_refund_part)
      order by l.service_date, l.order_number, l.seq) from month_lines l), '[]'::jsonb),
    'undated', coalesce((select jsonb_agg(jsonb_build_object('orderId', u.order_id, 'orderNumber', u.order_number, 'customer', u.customer,
        'product', u.product, 'kind', u.kind, 'amount', u.amount, 'state', u.state) order by u.order_number, u.seq) from undated u), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_sales_month(date, boolean) from public, anon, authenticated;
grant execute on function public.admin_sales_month(date, boolean) to service_role;

-- Décompte Mel / Eli (F13) : « revenus nets » = ventes maintenues du mois de
-- réalisation. Les encaissements (F7) restent fournis à titre d'information.
create or replace function public.settlement_month_figures(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  fin as (select public.admin_finance_month((select a from mm), false) as f),
  sales as (select public.admin_sales_month((select a from mm), false) as s),
  exp as (select e.* from public.expenses e, mm where public.expense_counted(e) and e.purchase_date between mm.a and mm.b),
  sal as (select s.* from public.salary_months s, mm where s.deleted_at is null and s.salary_month = mm.a)
  select jsonb_build_object(
    'month', (select a from mm), 'monthEnd', (select b from mm),
    'revenueBasis', 'sales',
    'revenueNet', ((select s from sales) -> 'cards' ->> 'net')::numeric,
    'salesGross', ((select s from sales) -> 'cards' ->> 'gross')::numeric,
    'salesCancelled', ((select s from sales) -> 'cards' ->> 'cancelled')::numeric,
    'salesGestures', ((select s from sales) -> 'cards' ->> 'gestures')::numeric,
    'salesToCollect', ((select s from sales) -> 'cards' ->> 'toCollect')::numeric,
    'collected', ((select f from fin) -> 'cards' ->> 'collected')::numeric,
    'refunded', ((select f from fin) -> 'cards' ->> 'refunded')::numeric,
    'refundsUndatedCount', ((select f from fin) -> 'cards' ->> 'undatedCount')::int,
    'refundsToReviewCount', ((select f from fin) -> 'cards' ->> 'toReviewCount')::int,
    'expensesKnown', coalesce((select sum(chf_amount) from exp), 0),
    'expensesCount', (select count(*) from exp),
    'expensesUnknown', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'supplier', supplier)) from exp where chf_amount is null), '[]'::jsonb),
    'expensesUndated', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'supplier', e.supplier))
                                 from public.expenses e where public.expense_counted(e) and e.purchase_date is null), '[]'::jsonb),
    'investments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'supplier', supplier, 'description', description, 'chf_amount', chf_amount) order by code)
                             from exp where is_investment), '[]'::jsonb),
    'salaryTotal', coalesce((select sum(confirmed_net) from sal), 0),
    'salaryLines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'confirmed', confirmed_net) order by code) from sal), '[]'::jsonb),
    'salaryToConfirm', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code)) from sal where confirmed_net is null), '[]'::jsonb)
  );
$$;

commit;
