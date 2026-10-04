-- F18 — Compta : les remboursements clients encore dus sont déduits du
-- « disponible à verser ». À appliquer APRÈS F17. Ne rejoue aucune migration,
-- ne modifie aucune donnée : seule public.treasury_at est remplacée.
-- Additive, relançable.
--
-- Règle, commande par commande, à la date D du solde bancaire :
--   * argent détenu = montant encaissé (commande payée au plus tard le D)
--     − remboursements comptés au plus tard le D (un remboursement compté
--     sans date est considéré comme déjà fait : il apparaît « à dater » ailleurs) ;
--   * à rendre au client = le plus grand de
--       - la valeur des articles annulés ou refusés de la commande (F17),
--       - les décisions de remboursement actives prises au plus tard le D,
--     moins les remboursements déjà faits au plus tard le D (jamais négatif).
--     Le plus grand des deux, et non leur somme : une décision prise pour un
--     article annulé n'est pas comptée une deuxième fois ;
--   * paiements pour commandes futures = comme F17 (articles maintenus
--     réalisés après D ou sans date, commande payée au plus tard le D) ;
--   * PAS DE DOUBLE COMPTAGE : pour une commande, futur + à rendre ne
--     dépasse jamais l'argent détenu pour elle (ex. geste décidé mais pas
--     encore remboursé sur un gâteau à venir). Le remboursement dû est
--     réservé d'abord, le reste de l'argent détenu couvre les gâteaux à venir.
-- Seuls les remboursements dus sur de l'argent déjà encaissé sont déduits :
-- une commande non payée ne réserve rien.

begin;

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
  per_order as (
    select p.id,
           greatest(p.collected - p.refunded, 0) as held,
           coalesce((select round(sum(l.amount - l.gesture_part), 2) from sl l
                     where l.order_id = p.id and l.state = 'kept' and (l.service_date is null or l.service_date > p_date)), 0) as future,
           coalesce((select round(sum(l.amount - l.gesture_part), 2) from sl l
                     where l.order_id = p.id and l.state = 'kept' and l.service_date is null), 0) as future_undated,
           greatest(
             greatest(
               coalesce((select sum(l.amount) from sl l where l.order_id = p.id and l.state in ('cancelled', 'refused')), 0),
               coalesce((select sum(d.amount) from public.order_refund_decisions d
                         where d.order_id = p.id and d.voided_at is null
                           and (d.decided_at at time zone 'Europe/Zurich')::date <= p_date), 0)
             ) - p.refunded, 0) as owed
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

revoke all on function public.treasury_at(date, numeric) from public, anon, authenticated;
grant execute on function public.treasury_at(date, numeric) to service_role;

commit;
