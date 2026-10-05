-- F25 — Remboursements : « Montant non remboursé » et montant décidé qui fait foi.
--
-- À appliquer après F24. Ne rejoue aucune migration, ne modifie aucune donnée :
-- deux nouvelles fonctions de lecture et le remplacement de quatre fonctions
-- existantes. Additive, relançable. Aucune fonction Edge à redéployer
-- (manage-refunds renvoie directement admin_order_refunds).
--
-- Problème : une commande payée 103 et annulée, pour laquelle on décide de
-- rembourser 102 (frais de paiement gardés), restait « 1 CHF à rembourser »
-- dans la Compta et dans la trésorerie, qui prenaient le plus grand de (prix
-- des articles annulés, décisions).
--
-- Règle F25 :
--   * Une décision « annulation » fixe le montant dû pour les articles annulés
--     qu'elle vise ; sans article visé, ou si elle vise tous les articles
--     annulés, elle couvre toute la commande. Un article annulé qu'aucune
--     décision ne couvre compte toujours en entier (comme avant).
--   * Classement inchangé par rapport à F19, avec une seule précision : une
--     décision admin sans article sur une commande dont TOUS les articles sont
--     annulés ou refusés est une décision d'annulation (avant : un geste).
--   * Montant dû d'une commande = décisions d'annulation + articles annulés non
--     couverts + gestes − remboursements faits. Une décision et l'article
--     qu'elle couvre ne sont jamais additionnés.
--   * « Montant non remboursé » = prix des articles annulés couverts − montant
--     décidé (jamais négatif). Présenté à part : il ne s'ajoute pas aux ventes.
--   * Workshops : la décision automatique est conservée ; une fois annulée à la
--     main (pour la remplacer par un montant ajusté), elle n'est plus réactivée.
--
-- Fonctions :
--   public.refund_decisions_classified(p_include_tests, p_date)  (nouvelle)
--   public.sales_cancel_due(p_include_tests, p_date)             (nouvelle)
--   public.treasury_at            (F19 remplacée : « remboursements dus »)
--   public.admin_sales_month      (F17 remplacée : reste à rembourser, notRefunded)
--   public.admin_order_refunds    (F6 remplacée : notRefunded, motifs, articles annulés)
--   public.sync_workshop_cancel_decision (F3 remplacée : décision annulée à la main respectée)

begin;

-- ── Décisions actives classées « geste » / « annulation » ────────────────
-- covered_items : articles annulés ou refusés visés ; covers_all : la décision
-- couvre tous les articles annulés de la commande (rien de visé parmi eux, ou
-- tous visés). p_date : décisions prises au plus tard ce jour (Zurich), null = toutes.
create or replace function public.refund_decisions_classified(p_include_tests boolean default false, p_date date default null)
returns table (decision_id uuid, order_id uuid, amount numeric, reason text, is_gesture boolean, covers_all boolean, covered_items uuid[])
language sql
stable
set search_path to ''
as $$
  with
  sl as (select * from public.sales_lines(p_include_tests)),
  off_items as (select distinct l.order_id, l.item_id from sl l where l.state in ('cancelled', 'refused') and l.item_id is not null),
  d as (
    select d.id, d.order_id, d.amount, d.reason, d.source,
           case when d.source = 'auto_from_refund'
                then array(select ri.order_item_id from public.order_manual_refund_items ri where ri.refund_id = d.refund_id)
                else array(select di.order_item_id from public.order_refund_decision_items di where di.decision_id = d.id)
           end as items
    from public.order_refund_decisions d
    where d.voided_at is null
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
         x.off_hit
  from x;
$$;

-- ── Montant dû et montant non remboursé par ligne annulée ou refusée ─────
-- Une ligne couverte par au moins une décision d'annulation reçoit sa part
-- des décisions (au prorata des prix, au centime, cumulatif) ; une ligne non
-- couverte est due en entier. Mêmes lignes et même numérotation (seq) que
-- public.sales_lines.
create or replace function public.sales_cancel_due(p_include_tests boolean default false, p_date date default null)
returns table (order_id uuid, seq bigint, amount numeric, due numeric, not_refunded numeric)
language sql
stable
set search_path to ''
as $$
  with
  sl as (select * from public.sales_lines(p_include_tests)),
  dec as (select * from public.refund_decisions_classified(p_include_tests, p_date) where not is_gesture),
  off as (
    select l.order_id, l.seq, l.amount,
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
    select w2.order_id, w2.seq, w2.amount,
           case when not w2.covered then w2.amount
                when w2.ctot > 0 then round(w2.dec_amount * w2.ccum / w2.ctot, 2) - round(w2.dec_amount * (w2.ccum - w2.cw) / w2.ctot, 2)
                else round(w2.dec_amount * w2.ncum / w2.ntot, 2) - round(w2.dec_amount * (w2.ncum - 1) / w2.ntot, 2)
           end as due
    from w2
  )
  select r.order_id, r.seq, r.amount, r.due, greatest(r.amount - r.due, 0) from r;
$$;

-- ── Trésorerie (F19) ──
create or replace function public.treasury_at(p_date date, p_balance numeric)
returns jsonb language sql stable set search_path to '' as $$
  with inv as (
    select e.* from public.expenses e
    where public.expense_counted(e) and not e.personal_advance and e.purchase_date <= p_date
      and (e.status = 'to_pay' or e.paid_at > p_date)
  ),
  sal as (
    select s.confirmed_net - coalesce((select sum(p.amount) from public.salary_payments p
                                       where p.salary_month_id = s.id and p.deleted_at is null and p.paid_at <= p_date), 0) as remaining
    from public.salary_months s where s.deleted_at is null and s.confirmed_net is not null and s.salary_month <= p_date
  ),
  adv as (
    select e.chf_amount - public.advance_repaid(e.id, p_date) as remaining, e.chf_amount
    from public.expenses e
    where e.deleted_at is null and e.personal_advance and e.status = 'paid' and public.advance_date(e) <= p_date
  ),
  shares as (
    select s.mel_share + s.eli_share - coalesce((select sum(p.share_amount) from public.settlement_payouts p
                                                  where p.settlement_id = s.id and p.voided_at is null and p.paid_at <= p_date), 0) as remaining
    from public.settlements s where (s.month + interval '1 month - 1 day')::date <= p_date
  ),
  last as (select * from public.settlements where (month + interval '1 month - 1 day')::date <= p_date order by month desc limit 1),
  -- Commandes vendues (F17), payées au plus tard le D.
  sl as (select * from public.sales_lines(false)),
  paid as (
    select o.id,
           round(coalesce(o.paid_amount, o.total_amount), 2) as collected,
           coalesce((select round(sum(r.amount), 2) from public.order_manual_refunds r
                     where r.order_id = o.id and r.status = 'counted'
                       and (r.refunded_at is null or (r.refunded_at at time zone 'Europe/Zurich')::date <= p_date)), 0) as refunded
    from public.orders o
    where o.id in (select order_id from sl)
      and o.paid_at is not null and o.payment_status::text <> 'pending'
      and (o.paid_at at time zone 'Europe/Zurich')::date <= p_date
  ),
  -- F25 : décisions actives au plus tard le D, classées « geste » ou
  -- « annulation » (public.refund_decisions_classified), et montant dû par
  -- article annulé ou refusé (public.sales_cancel_due) : la décision couvre
  -- les articles qu'elle vise ; un article annulé sans décision compte en entier.
  dec as (select * from public.refund_decisions_classified(false, p_date)),
  cdue as (select * from public.sales_cancel_due(false, p_date)),
  per_order as (
    select p.id,
           greatest(p.collected - p.refunded, 0) as held,
           coalesce((select round(sum(l.amount - l.gesture_part), 2) from sl l
                     where l.order_id = p.id and l.state = 'kept' and (l.service_date is null or l.service_date > p_date)), 0) as future,
           coalesce((select round(sum(l.amount - l.gesture_part), 2) from sl l
                     where l.order_id = p.id and l.state = 'kept' and l.service_date is null), 0) as future_undated,
           greatest(
             coalesce((select sum(c.due) from cdue c where c.order_id = p.id), 0)
             + coalesce((select sum(d.amount) from dec d where d.order_id = p.id and not d.is_gesture
                           and not exists (select 1 from sl l where l.order_id = p.id and l.state in ('cancelled', 'refused'))), 0)
             + coalesce((select sum(d.amount) from dec d where d.order_id = p.id and d.is_gesture), 0)
             - p.refunded, 0) as owed
    from paid p
  ),
  reserved as (
    select r.*,
           least(r.owed, r.held) as refund_owed,
           least(r.future, r.held - least(r.owed, r.held)) as pre,
           least(r.future_undated, r.held - least(r.owed, r.held)) as pre_undated
    from per_order r
  ),
  owe as (
    select l.amount - l.gesture_part as value from sl l join public.orders o on o.id = l.order_id
    where l.state = 'kept' and l.service_date <= p_date
      and not (o.paid_at is not null and o.payment_status::text <> 'pending' and (o.paid_at at time zone 'Europe/Zurich')::date <= p_date)
  ),
  t as (
    select coalesce((select sum(chf_amount) from inv), 0) as inv,
           coalesce((select sum(greatest(remaining, 0)) from sal), 0) as sal,
           coalesce((select sum(greatest(remaining, 0)) from adv where chf_amount is not null), 0) as adv,
           coalesce((select sum(greatest(remaining, 0)) from shares), 0) as shares,
           coalesce((select round(sum(pre), 2) from reserved), 0) as pre,
           coalesce((select round(sum(refund_owed), 2) from reserved), 0) as refunds
  )
  select jsonb_build_object(
    'date', p_date,
    'balance', p_balance,
    'invoicesToPay', t.inv,
    'invoicesUnknownCount', (select count(*) from inv where chf_amount is null),
    'salaryRemaining', t.sal,
    'advancesToRepay', t.adv,
    'advancesUnknownCount', (select count(*) from adv where chf_amount is null),
    'sharesUnpaid', t.shares,
    'customerPrepayments', t.pre,
    'customerPrepaymentsUndated', coalesce((select round(sum(pre_undated), 2) from reserved), 0),
    'customerRefundsOwed', t.refunds,
    'customerRefundsOwedCount', (select count(*) from reserved where refund_owed > 0),
    'customersOwe', coalesce((select round(sum(value), 2) from owe), 0),
    'available', p_balance - t.inv - t.sal - t.adv - t.shares - t.pre - t.refunds,
    'baseConstituted', coalesce((select base_constituted from last), false),
    'extraCum', coalesce((select extra_cum from last), 0),
    'retainedCum', coalesce((select retained_cum from last), 0)
  )
  from t;
$$;

-- ── Ventes du mois (F17) ──
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
  lines as (select * from public.sales_lines(p_include_tests)),
  -- F25 : montant dû et montant non remboursé de chaque article annulé ou refusé.
  cdue as (select * from public.sales_cancel_due(p_include_tests, null)),
  month_lines as (
    select l.*, s.order_number, s.origin, s.customer, s.is_test, s.payment_status::text as payment_status, s.paid_at,
           s.order_validation::text as order_validation, s.created_via,
           c.due, coalesce(c.not_refunded, 0) as not_refunded
    from lines l join sold s on s.id = l.order_id
    left join cdue c on c.order_id = l.order_id and c.seq = l.seq
    where l.service_date between v_from and v_to
  ),
  undated as (
    select l.*, s.order_number, s.customer from lines l join sold s on s.id = l.order_id where l.service_date is null
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
      -- F25 : le montant décidé fait foi (par commande, jamais négatif) ; sans décision, le prix de l'article.
      'cancellationsToRefund', (select coalesce(round(sum(greatest(x.due - x.refunded, 0)), 2), 0) from (
                                  select order_id, sum(coalesce(due, amount)) as due, sum(cancel_refund_part) as refunded from month_lines
                                  where state = 'cancelled' and payment_status in ('paid', 'refunded') group by order_id) x),
      'notRefunded', (select coalesce(round(sum(not_refunded), 2), 0) from month_lines
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
        'gesture', l.gesture_part, 'cancellationRefund', l.cancel_refund_part, 'due', l.due, 'notRefunded', l.not_refunded)
      order by l.service_date, l.order_number, l.seq) from month_lines l), '[]'::jsonb),
    'undated', coalesce((select jsonb_agg(jsonb_build_object('orderId', u.order_id, 'orderNumber', u.order_number, 'customer', u.customer,
        'product', u.product, 'kind', u.kind, 'amount', u.amount, 'state', u.state) order by u.order_number, u.seq) from undated u), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ── Fiche commande, bloc Remboursements (F6) ──
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
                                    where d.order_id = o.id and not d.is_gesture and d.reason is not null), '[]'::jsonb),
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

-- ── Décision workshop automatique (F3) ──
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

  -- F25 : décision annulée à la main (par exemple pour garder des frais de
  -- paiement, puis remplacée par une décision au bon montant) : jamais
  -- réactivée ni modifiée automatiquement.
  if v_dec.id is not null and v_dec.voided_at is not null and coalesce(v_dec.voided_by, 'system') <> 'system' then
    return v_dec.id;
  end if;

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

do $$
declare f text;
begin
  foreach f in array array[
    'refund_decisions_classified(boolean, date)',
    'sales_cancel_due(boolean, date)',
    'treasury_at(date, numeric)',
    'admin_sales_month(date, boolean)',
    'admin_order_refunds(uuid)',
    'sync_workshop_cancel_decision(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
