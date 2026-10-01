-- F4 — Ajustement unique du cashback après remboursement.
--
-- Plan v3.1 §4.4, décision D2 : cashback de 3,5 % sur toutes les dépenses du
-- site, workshops compris ; un remboursement l'ajuste UNE seule fois.
-- Corrigé le 02.10.2026 : ne jamais confondre retrait théorique et retrait
-- réel, ne jamais créditer un montant supposé.
--
-- Cette migration CRÉE seulement les fonctions (aucun trigger, aucun
-- changement de comportement). Le basculement est fait par F5.
--
-- Deux montants par commande (colonnes F1) :
--   cashback_refund_target     = retrait VISÉ au dernier recalcul
--                                = min( tronqué( min(Σ remboursements comptés, Base) × 3,5 % ), cashback gagné )
--                                  avec Base = Σ articles − bienvenue − cagnotte utilisée (formule du gain) ;
--   cashback_refund_adjustment = retrait RÉELLEMENT appliqué au lot.
--
-- recompute_order_cashback() ne réagit qu'à la VARIATION du retrait visé :
--   visé augmente de d → retire min(d, solde du lot) ; jamais sous 0 (si le
--                        cashback est déjà dépensé, rien n'est repris ailleurs) ;
--   visé baisse de d   → rend min(d, retrait réel, place dans le lot) : jamais
--                        plus que ce qui a réellement été retiré ;
--                        si cashback_needs_review (historique ambigu) : RIEN
--                        n'est rendu, une anomalie est notée, et le visé reste
--                        inchangé jusqu'à vérification.
-- Rejouer la fonction ne fait rien (variation nulle). Une dépense ultérieure
-- de la cagnotte ne provoque jamais de crédit.
--
-- init_order_cashback_tracking() (appelée par F5, une fois par commande)
-- établit, pour l'historique d'avant F5 :
--   visé  = ce que l'ancien mécanisme visait (cashback gagné − reward_amount_earned) ;
--   réel  = gagné − solde du lot − cagnotte de ce lot engagée/dépensée
--           (reward_reservation_items des réservations 'reserved' / 'consumed') ;
--   historique ambigu (réel négatif, réel > visé, ou réservation libérée sur un
--   lot expiré dont on ne sait pas si elle a été rendue) → cashback_needs_review
--   + anomalie, réel retenu borné à [0, visé].
-- Une commande passée en payment_status = 'refunded' reste gérée par
-- refund_reward_for_order() (inchangé).

begin;

create or replace function public.init_order_cashback_tracking(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.orders%rowtype;
  v_earned public.reward_transactions%rowtype;
  v_target numeric;
  v_held numeric;
  v_real numeric;
  v_ambiguous boolean := false;
  v_detail text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  -- Déjà initialisée, ou déjà suivie par recompute_order_cashback : rien à faire.
  if not found or v_order.cashback_refund_initialized_at is not null
     or coalesce(v_order.cashback_refund_target, 0) <> 0
     or coalesce(v_order.cashback_refund_adjustment, 0) <> 0 then
    if found and v_order.cashback_refund_initialized_at is null then
      update public.orders set cashback_refund_initialized_at = now() where id = p_order_id;
    end if;
    return;
  end if;

  select * into v_earned
  from public.reward_transactions
  where order_id = p_order_id and type = 'earned'
  limit 1;

  if v_earned.id is null or v_order.customer_id is null or v_order.payment_status::text = 'refunded' then
    update public.orders set cashback_refund_initialized_at = now() where id = p_order_id;
    return;
  end if;

  v_target := greatest(round(v_earned.amount - coalesce(v_order.reward_amount_earned, v_earned.amount), 2), 0);

  select coalesce(sum(rri.amount), 0) into v_held
  from public.reward_reservation_items rri
  join public.reward_reservations rr on rr.order_id = rri.order_id
  where rri.reward_transaction_id = v_earned.id
    and rr.status in ('reserved', 'consumed');

  v_real := round(v_earned.amount - coalesce(v_earned.remaining_amount, 0) - v_held, 2);

  if v_real < -0.004 or v_real > v_target + 0.004 then
    v_ambiguous := true;
    v_detail := format('Retrait réel calculé %s hors de [0 ; %s] (gagné %s, solde %s, engagé/dépensé %s).',
                       v_real, v_target, v_earned.amount, v_earned.remaining_amount, v_held);
  elsif exists (
    select 1
    from public.reward_reservation_items rri
    join public.reward_reservations rr on rr.order_id = rri.order_id
    where rri.reward_transaction_id = v_earned.id
      and rr.status = 'released'
      and v_earned.expires_at is not null
      and rr.released_at is not null
      and v_earned.expires_at <= rr.released_at
  ) then
    v_ambiguous := true;
    v_detail := 'Réservation libérée sur un lot expiré : restitution inconnue.';
  end if;

  update public.orders
     set cashback_refund_target = v_target,
         cashback_refund_adjustment = least(greatest(v_real, 0), v_target),
         cashback_needs_review = v_ambiguous,
         cashback_refund_initialized_at = now()
   where id = p_order_id;

  if v_ambiguous then
    insert into public.refund_anomalies (order_id, kind, source, source_ref, requested, recorded, detail)
    values (p_order_id, 'cashback_historique_ambigu', 'cashback', v_earned.id::text, v_target,
            least(greatest(v_real, 0), v_target), v_detail)
    on conflict do nothing;
  end if;
end;
$$;

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
  v_delta := round(v_desired - coalesce(v_order.cashback_refund_target, 0), 2);

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
       set cashback_refund_adjustment = round(coalesce(cashback_refund_adjustment, 0) + v_move, 2),
           cashback_refund_target = v_desired,
           reward_amount_earned = round(v_earned.amount - v_desired, 2)
     where id = p_order_id;

  elsif v_delta < 0 then
    if v_order.cashback_needs_review then
      -- Historique ambigu : on ne crédite pas un montant supposé.
      insert into public.refund_anomalies (order_id, kind, source, source_ref, requested, recorded, detail)
      values (p_order_id, 'cashback_restitution_bloquee', 'cashback', v_earned.id::text, -v_delta, 0,
              'Restitution de cashback non appliquée : historique du lot ambigu, à vérifier.')
      on conflict do nothing;
    else
      v_move := least(-v_delta,
                      greatest(coalesce(v_order.cashback_refund_adjustment, 0), 0),
                      greatest(v_earned.amount - coalesce(v_earned.remaining_amount, 0), 0));
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
         set cashback_refund_adjustment = greatest(round(coalesce(cashback_refund_adjustment, 0) - v_move, 2), 0),
             cashback_refund_target = v_desired,
             reward_amount_earned = round(v_earned.amount - v_desired, 2)
       where id = p_order_id;
    end if;
  end if;

  if v_order.cashback_refund_initialized_at is null then
    update public.orders set cashback_refund_initialized_at = now() where id = p_order_id;
  end if;

  perform public.recompute_reward_balance(v_order.customer_id);
  return v_desired;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['init_order_cashback_tracking(uuid)', 'recompute_order_cashback(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
