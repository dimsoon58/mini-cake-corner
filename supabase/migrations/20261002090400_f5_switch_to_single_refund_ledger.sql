-- F5 — Bascule vers le registre unique (à appliquer d'un seul bloc, après F1–F4).
--
-- Plan v3 §4.3 / §4.4. Tout est dans UNE transaction : si une étape échoue,
-- rien n'est changé.
--
-- Ce que fait cette migration :
--   1. Initialise orders.cashback_refund_adjustment avec ce qui a DÉJÀ été
--      retiré par les anciens mécanismes (cashback gagné − reward_amount_earned),
--      pour que le premier recalcul ne retire rien une seconde fois.
--   2. Remplace les deux anciens mécanismes de retrait de cashback :
--        - trigger trg_order_refunds_reward_adjustment (sur order_refunds) → supprimé ;
--        - bloc « retirer 3,5 % » de finalize_workshop_refund → retiré
--          (le reste de la fonction est identique, copié de la production).
--      Le seul ajustement est désormais recompute_order_cashback(), appelé
--      par un trigger sur le registre unique.
--   3. Recopie automatique vers le registre unique, SANS modifier Make :
--        - order_refunds (écrit par Make 7425367 module 48 via
--          sync_manual_accounting_refund_event, inchangée) → ingest_refund(source 'make_notion') ;
--        - workshop_cancellation_log : nouvelle annulation avec montant dû →
--          décision 'workshop_cancel' ; remboursement confirmé → ingest_refund(source 'workshop').
--      Une erreur inattendue est notée dans refund_ingest_errors et ne fait
--      jamais échouer l'appel d'origine.
--   4. Reprend les données EXISTANTES (ce sont des tests, conservées pour
--      tester — exclues des chiffres par is_test une fois la liste validée) :
--      décisions d'après refund_due_amount / refund_status / annulations
--      workshop, puis les lignes de order_refunds et les remboursements
--      workshop confirmés, avec la détection de doublons normale.
--      Rien n'est supprimé.
--   5. Recalcule le cashback de chaque commande (une fois, idempotent).
--
-- Ne touche pas : Make, Notion, sync_manual_accounting_refund_event,
-- order_refunds (table et données), accounting_monthly_summary,
-- refund_reward_for_order, restore_workshop_reward, finalize_reward_for_order.

begin;

-- ── 1. Ce qui a déjà été retiré ──────────────────────────────────────────
update public.orders o
   set cashback_refund_adjustment = greatest(round(rt.amount - coalesce(o.reward_amount_earned, 0), 2), 0)
  from public.reward_transactions rt
 where rt.order_id = o.id
   and rt.type = 'earned'
   and o.cashback_refund_adjustment = 0;

-- ── 2a. Ancien trigger cashback sur order_refunds ────────────────────────
drop trigger if exists trg_order_refunds_reward_adjustment on public.order_refunds;

-- ── 2b. finalize_workshop_refund sans retrait de cashback ────────────────
CREATE OR REPLACE FUNCTION public.finalize_workshop_refund(p_log_id uuid, p_refund_status text, p_refund_amount_completed numeric, p_postfinance_refund_id text)
 RETURNS workshop_cancellation_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_log public.workshop_cancellation_log%rowtype;
  v_res public.workshop_reservations%rowtype;
  v_order public.orders%rowtype;
begin
  if p_refund_status not in ('refunded', 'failed', 'pending', 'outside_window', 'non_required') then
    raise exception 'invalid p_refund_status %', p_refund_status using errcode = 'P0001';
  end if;

  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.id = p_log_id
  for update;

  if not found then
    raise exception 'cancellation log % not found', p_log_id using errcode = 'P0002';
  end if;

  if p_refund_status = 'refunded' and v_log.refund_status <> 'refunded' then
    select wr.* into v_res
    from public.workshop_reservations wr
    where wr.id = v_log.reservation_id
    for update;

    if found then
      update public.workshop_reservations wr
      set refunded_amount = wr.refunded_amount + coalesce(p_refund_amount_completed, 0)
      where wr.id = v_log.reservation_id;

      select o.* into v_order
      from public.orders o
      where o.id = v_res.order_id
      for update;

      -- 2026-10-02 (F4) : le retrait de cashback n'est plus fait ici. Il est
      -- recalculé une seule fois par recompute_order_cashback(), à partir du
      -- registre unique des remboursements (le trigger sur workshop_cancellation_log
      -- y enregistre ce remboursement). Évite le double retrait.
    end if;
  end if;

  update public.workshop_reservations
  set updated_at = now()
  where id = v_log.reservation_id;

  update public.workshop_cancellation_log
  set refund_status            = p_refund_status,
      refund_amount_completed  = case when p_refund_status = 'refunded'
                                      then coalesce(p_refund_amount_completed, 0)
                                      else refund_amount_completed end,
      postfinance_refund_id    = coalesce(p_postfinance_refund_id, postfinance_refund_id),
      updated_at               = now()
  where id = p_log_id
  returning * into v_log;

  return v_log;
end;
$function$;

-- ── 2c. Seul ajustement : trigger sur le registre unique ─────────────────
create or replace function public.trg_refund_ledger_cashback()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.order_id is distinct from coalesce(new.order_id, old.order_id) then
    perform public.recompute_order_cashback(old.order_id);
  end if;
  perform public.recompute_order_cashback(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;

drop trigger if exists trg_refund_ledger_cashback on public.order_manual_refunds;
create trigger trg_refund_ledger_cashback
  after insert or delete or update of status, amount, order_id on public.order_manual_refunds
  for each row execute function public.trg_refund_ledger_cashback();

-- ── 3a. order_refunds (Make) → registre ──────────────────────────────────
create or replace function public.trg_order_refunds_to_ledger()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status = 'successful' then
    begin
      perform public.ingest_refund(
        p_order_id      => new.order_id,
        p_amount        => new.amount,
        p_refunded_at   => new.completed_at,
        p_source        => 'make_notion',
        p_source_ref    => new.postfinance_refund_id,
        p_reference     => new.postfinance_refund_id,
        p_note          => 'Recopié automatiquement de order_refunds',
        p_item_ids      => case when new.order_item_id is not null then array[new.order_item_id] end,
        p_created_by    => 'make'
      );
    exception when others then
      insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
      values ('make_notion', new.postfinance_refund_id, new.order_id, sqlerrm, to_jsonb(new));
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_order_refunds_to_ledger on public.order_refunds;
create trigger trg_order_refunds_to_ledger
  after insert or update on public.order_refunds
  for each row execute function public.trg_order_refunds_to_ledger();

-- ── 3b. workshop_cancellation_log → décision / registre ──────────────────
create or replace function public.trg_workshop_log_to_refunds()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
begin
  select wr.order_id, wr.order_item_id into v_order_id, v_item_id
  from public.workshop_reservations wr where wr.id = new.reservation_id;
  if v_order_id is null then return null; end if;

  if tg_op = 'INSERT' and coalesce(new.refund_amount_requested, 0) > 0 then
    begin
      perform public.record_refund_decision(
        p_order_id      => v_order_id,
        p_amount        => new.refund_amount_requested,
        p_reason        => format('Annulation de %s place(s) workshop', new.seats_cancelled),
        p_source        => 'workshop_cancel',
        p_item_ids      => array[v_item_id],
        p_by            => 'system',
        p_source_ref    => new.id::text,
        p_enforce_cap   => false
      );
    exception when others then
      insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
      values ('workshop_cancel', new.id::text, v_order_id, sqlerrm, to_jsonb(new));
    end;
  end if;

  if new.refund_status = 'refunded'
     and (tg_op = 'INSERT' or old.refund_status is distinct from 'refunded')
     and coalesce(new.refund_amount_completed, 0) > 0 then
    begin
      perform public.ingest_refund(
        p_order_id      => v_order_id,
        p_amount        => new.refund_amount_completed,
        p_refunded_at   => new.updated_at,
        p_source        => 'workshop',
        p_source_ref    => new.id::text,
        p_reference     => new.postfinance_refund_id,
        p_note          => 'Remboursement workshop confirmé',
        p_item_ids      => array[v_item_id],
        p_created_by    => 'system'
      );
    exception when others then
      insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
      values ('workshop', new.id::text, v_order_id, sqlerrm, to_jsonb(new));
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_workshop_log_to_refunds on public.workshop_cancellation_log;
create trigger trg_workshop_log_to_refunds
  after insert or update of refund_status, refund_amount_completed on public.workshop_cancellation_log
  for each row execute function public.trg_workshop_log_to_refunds();

do $$
declare f text;
begin
  foreach f in array array['trg_refund_ledger_cashback()', 'trg_order_refunds_to_ledger()', 'trg_workshop_log_to_refunds()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── 4. Reprise des données existantes (tests, rien n'est supprimé) ───────
-- 4a. Décisions existantes.
insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, decided_at, decided_by)
select o.id, o.refund_due_amount, 'Repris de orders.refund_due_amount', 'legacy_due', o.id::text,
       coalesce(o.cancelled_at, o.refund_marked_at, o.created_at), 'migration'
from public.orders o
where o.refund_due_amount > 0
on conflict do nothing;

insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, decided_at, decided_by)
select o.id, public.order_collected_amount(o.id),
       'Repris de orders.refund_status (montant non renseigné : encaissé total)', 'legacy_due', o.id::text,
       coalesce(o.cancelled_at, o.refund_marked_at, o.created_at), 'migration'
from public.orders o
where o.refund_status in ('to_refund', 'refunded')
  and coalesce(o.refund_due_amount, 0) = 0
  and public.order_collected_amount(o.id) > 0
on conflict do nothing;

insert into public.order_refund_decisions (order_id, amount, reason, source, source_ref, decided_at, decided_by)
select wr.order_id, l.refund_amount_requested,
       format('Annulation de %s place(s) workshop', l.seats_cancelled), 'workshop_cancel', l.id::text,
       l.created_at, 'migration'
from public.workshop_cancellation_log l
join public.workshop_reservations wr on wr.id = l.reservation_id
where l.refund_amount_requested > 0
on conflict do nothing;

-- 4b. Saisies admin déjà présentes : couverture par une décision automatique si besoin.
do $$
declare r record;
begin
  for r in select id from public.order_manual_refunds where status = 'counted' order by created_at loop
    perform public.refresh_auto_refund_decision(r.id, 'migration');
  end loop;
end $$;

-- 4c. Lignes Make existantes (order_refunds), dans l'ordre chronologique.
do $$
declare r record;
begin
  for r in select * from public.order_refunds where status = 'successful' order by created_at loop
    perform public.ingest_refund(
      p_order_id => r.order_id, p_amount => r.amount, p_refunded_at => r.completed_at,
      p_source => 'make_notion', p_source_ref => r.postfinance_refund_id,
      p_reference => r.postfinance_refund_id, p_note => 'Repris de order_refunds',
      p_item_ids => case when r.order_item_id is not null then array[r.order_item_id] end,
      p_created_by => 'migration');
  end loop;
end $$;

-- 4d. Remboursements workshop déjà confirmés.
do $$
declare r record;
begin
  for r in
    select l.*, wr.order_id, wr.order_item_id
    from public.workshop_cancellation_log l
    join public.workshop_reservations wr on wr.id = l.reservation_id
    where l.refund_status = 'refunded' and l.refund_amount_completed > 0
    order by l.updated_at
  loop
    perform public.ingest_refund(
      p_order_id => r.order_id, p_amount => r.refund_amount_completed, p_refunded_at => r.updated_at,
      p_source => 'workshop', p_source_ref => r.id::text, p_reference => r.postfinance_refund_id,
      p_note => 'Repris du suivi workshop', p_item_ids => array[r.order_item_id], p_created_by => 'migration');
  end loop;
end $$;

-- ── 5. Recalcul du cashback de chaque commande (idempotent) ──────────────
do $$
declare r record;
begin
  for r in select distinct order_id from public.reward_transactions where type = 'earned' and order_id is not null loop
    perform public.recompute_order_cashback(r.order_id);
  end loop;
end $$;

commit;
