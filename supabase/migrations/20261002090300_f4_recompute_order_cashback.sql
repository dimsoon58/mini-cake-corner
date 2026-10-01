-- F4 — Fonction unique d'ajustement du cashback après remboursement.
--
-- Plan v3 §4.4, décision D2 (01.10.2026) : le cashback est de 3,5 % sur
-- toutes les dépenses du site, workshops compris ; un remboursement l'ajuste
-- une seule fois.
--
-- Cette migration CRÉE seulement la fonction (aucun trigger, aucun
-- changement de comportement). Le basculement (triggers, retrait des
-- anciens mécanismes, initialisation) est fait d'un bloc par F5.
--
-- Calcul, sur le total (jamais par addition de retraits successifs) :
--   Base    = Σ order_items.total − bienvenue − cagnotte utilisée   (formule du gain)
--   Retrait visé = min( tronqué( min(Σ remboursements comptés, Base) × 3,5 % ), cashback gagné )
--   Delta   = Retrait visé − orders.cashback_refund_adjustment (déjà retiré)
--   Delta > 0 : retiré du lot « earned » de la commande, sans passer sous 0
--               (si le cashback est déjà dépensé, rien n'est repris ailleurs) ;
--   Delta < 0 : rendu au lot (correction, doublon reclassé), sans dépasser le
--               montant gagné.
-- cashback_refund_adjustment mémorise ce qui a VRAIMENT été retiré : rejouer
-- la fonction ne retire rien de plus.
--
-- Une commande passée en payment_status = 'refunded' est laissée à
-- refund_reward_for_order() (inchangé) ; le nouveau flux ne provoque plus ce
-- passage (décision D1).

begin;

create or replace function public.recompute_order_cashback(p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.orders%rowtype;
  v_earned public.reward_transactions%rowtype;
  v_base numeric;
  v_refunded numeric;
  v_desired numeric;
  v_delta numeric;
  v_move numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id is null or v_order.payment_status::text = 'refunded' then
    return 0;
  end if;

  select * into v_earned
  from public.reward_transactions
  where order_id = p_order_id and type = 'earned'
  limit 1
  for update;
  if not found then
    return 0;
  end if;

  select greatest(coalesce(sum(oi.total), 0)
                  - coalesce(v_order.welcome_discount_amount, 0)
                  - coalesce(v_order.reward_amount_used, 0), 0)
    into v_base
  from public.order_items oi
  where oi.order_id = p_order_id;

  select coalesce(sum(r.amount), 0) into v_refunded
  from public.order_manual_refunds r
  where r.order_id = p_order_id and r.status = 'counted';

  v_desired := least(trunc(least(v_refunded, v_base) * 0.035, 2), v_earned.amount);
  v_delta := round(v_desired - coalesce(v_order.cashback_refund_adjustment, 0), 2);

  if v_delta > 0 then
    v_move := least(v_delta, greatest(coalesce(v_earned.remaining_amount, 0), 0));
    if v_move > 0 then
      update public.reward_transactions
         set remaining_amount = round(remaining_amount - v_move, 2),
             note = case
               when coalesce(note, '') = '' then 'Cashback ajusté après remboursement'
               when note like '%Cashback ajusté après remboursement%' then note
               else note || ' | Cashback ajusté après remboursement'
             end
       where id = v_earned.id;
    end if;
    update public.orders
       set cashback_refund_adjustment = round(coalesce(cashback_refund_adjustment, 0) + v_move, 2)
     where id = p_order_id;
  elsif v_delta < 0 then
    v_move := least(-v_delta, greatest(v_earned.amount - coalesce(v_earned.remaining_amount, 0), 0));
    if v_move > 0 then
      update public.reward_transactions
         set remaining_amount = round(remaining_amount + v_move, 2),
             note = case
               when note like '%Cashback rendu après correction%' then note
               else coalesce(nullif(note, '') || ' | ', '') || 'Cashback rendu après correction'
             end
       where id = v_earned.id;
    end if;
    update public.orders
       set cashback_refund_adjustment = greatest(round(coalesce(cashback_refund_adjustment, 0) + v_delta, 2), 0)
     where id = p_order_id;
  end if;

  update public.orders
     set reward_amount_earned = round(v_earned.amount - v_desired, 2)
   where id = p_order_id
     and reward_amount_earned is distinct from round(v_earned.amount - v_desired, 2);

  perform public.recompute_reward_balance(v_order.customer_id);
  return v_desired;
end;
$$;

revoke all on function public.recompute_order_cashback(uuid) from public, anon, authenticated;
grant execute on function public.recompute_order_cashback(uuid) to service_role;

commit;
