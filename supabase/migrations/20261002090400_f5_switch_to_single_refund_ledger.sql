-- F5 — Bascule vers le registre unique (à appliquer d'un seul bloc, après F1–F4).
--
-- Plan v3.1 §4.3 / §4.4, corrigé après relecture (02.10.2026). Tout est dans
-- UNE transaction : si une étape échoue, rien n'est changé.
--
--   1. Établit, pour chaque commande, le retrait de cashback que l'ancien
--      mécanisme VISAIT et celui qu'il a RÉELLEMENT appliqué (le cashback a pu
--      être dépensé entre-temps) : le premier recalcul ne retire rien une
--      seconde fois, et une correction ultérieure ne rend jamais plus que le
--      retrait réel. Historique ambigu → signalé (refund_anomalies), aucune
--      restitution automatique.
--   2. Remplace les deux anciens mécanismes de retrait de cashback :
--        - trigger trg_order_refunds_reward_adjustment (order_refunds) → supprimé ;
--        - bloc « retirer 3,5 % » de finalize_workshop_refund → retiré
--          (reste de la fonction identique à la production).
--      Seul ajustement désormais : recompute_order_cashback(), via un trigger
--      sur le registre unique (statut / montant).
--   3. Protège le registre :
--        - formulaire admin ACTUEL (écrit directement dans
--          order_manual_refunds) → même contrôle que ingest_refund (plafond,
--          doublons, double clic, commande encaissée), date « à dater »,
--          excédent couvert par une décision automatique ;
--        - modification directe d'un montant / statut / date → refusée ;
--          suppression → refusée.
--   4. Recopie automatique, SANS modifier Make :
--        - order_refunds (Make 7425367 module 48, via
--          sync_manual_accounting_refund_event, inchangée) → ingest_refund
--          (source 'make_notion'). Date : celle envoyée par Make ; si Make
--          n'en envoie pas (la fonction met alors now(), à la création comme
--          au rejeu), la ligne reste « à dater » et une date déjà connue n'est
--          jamais remplacée.
--        - workshop_cancellation_log :
--            montant dû (création ou changement) → décision 'workshop_cancel',
--              tenue à jour, plafonnée à l'encaissé (anomalie sinon) ;
--            statut 'refunded' (passage, OU correction du montant / de la
--              référence en restant 'refunded') → la MÊME ligne du registre
--              est créée ou mise à jour (« à dater » : le suivi workshop ne
--              connaît pas la date réelle) ;
--            sortie du statut 'refunded' → la ligne du registre est annulée.
--      Toute erreur inattendue est notée dans refund_ingest_errors et ne fait
--      jamais échouer l'appel d'origine.
--   5. Reprend les données EXISTANTES (des tests, rien n'est supprimé) :
--        a) décisions workshop (une par annulation) ;
--        b) décisions d'après refund_due_amount, plafonnées au disponible
--           (anomalie si réduites) ;
--        c) commandes « à rembourser » sans montant : décision = disponible
--           restant (encaissé − déjà décidé), jamais plus ;
--        d) saisies admin existantes, lignes Make, remboursements workshop.
--      Une même obligation n'est jamais comptée deux fois : chaque source a sa
--      clé unique, et le total décidé ne dépasse jamais l'encaissé.
--   6. Recalcule le cashback de chaque commande (une fois, idempotent).
--
-- Ne touche pas : Make, Notion, sync_manual_accounting_refund_event,
-- order_refunds (table et données), accounting_monthly_summary,
-- refund_reward_for_order, restore_workshop_reward, finalize_reward_for_order.

begin;

-- ── 1. Historique du cashback : visé (ancien mécanisme) et retrait RÉEL ──
-- init_order_cashback_tracking (F4) : une fois par commande ; historique
-- ambigu → cashback_needs_review + anomalie, jamais de crédit supposé.
do $$
declare r record;
begin
  for r in select id from public.orders where cashback_refund_initialized_at is null order by created_at loop
    perform public.init_order_cashback_tracking(r.id);
  end loop;
end $$;

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

-- ── 3. Garde du registre (formulaire admin actuel, écritures directes) ───
drop trigger if exists trg_refund_ledger_guard on public.order_manual_refunds;
create trigger trg_refund_ledger_guard
  before insert or update or delete on public.order_manual_refunds
  for each row execute function public.trg_refund_ledger_guard();

drop trigger if exists trg_refund_ledger_after_insert on public.order_manual_refunds;
create trigger trg_refund_ledger_after_insert
  after insert on public.order_manual_refunds
  for each row execute function public.trg_refund_ledger_after_insert();

-- ── 4a. order_refunds (Make) → registre ──────────────────────────────────
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
        -- Date non envoyée par Make : sync_manual_accounting_refund_event met
        -- alors now() (heure de la transaction), à la création COMME au rejeu.
        -- completed_at = now() ou = created_at → date inconnue, « à dater ».
        -- Un rejeu sans date ne remplace jamais une date déjà connue.
        p_refunded_at   => case when new.completed_at = now() or new.completed_at = new.created_at
                                then null else new.completed_at end,
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

-- ── 4b. workshop_cancellation_log → décision / registre ──────────────────
create or replace function public.trg_workshop_log_to_refunds()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order_id uuid;
  v_item_id uuid;
  v_ledger uuid;
begin
  select wr.order_id, wr.order_item_id into v_order_id, v_item_id
  from public.workshop_reservations wr where wr.id = new.reservation_id;
  if v_order_id is null then return null; end if;

  -- Montant dû → décision (création ou mise à jour).
  if tg_op = 'INSERT' or new.refund_amount_requested is distinct from old.refund_amount_requested then
    begin
      perform public.sync_workshop_cancel_decision(new.id);
    exception when others then
      insert into public.refund_ingest_errors (source, source_ref, order_id, error, payload)
      values ('workshop_cancel', new.id::text, v_order_id, sqlerrm, to_jsonb(new));
    end;
  end if;

  -- Remboursement confirmé : passage à 'refunded' OU correction du montant /
  -- de la référence en restant 'refunded' → même ligne du registre.
  if new.refund_status = 'refunded' and coalesce(new.refund_amount_completed, 0) > 0
     and (tg_op = 'INSERT'
          or old.refund_status is distinct from 'refunded'
          or new.refund_amount_completed is distinct from old.refund_amount_completed
          or new.postfinance_refund_id is distinct from old.postfinance_refund_id) then
    begin
      perform public.ingest_refund(
        p_order_id      => v_order_id,
        p_amount        => new.refund_amount_completed,
        p_refunded_at   => null,   -- le suivi workshop ne connaît pas la date réelle
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
  elsif tg_op = 'UPDATE' and old.refund_status = 'refunded'
        and (new.refund_status is distinct from 'refunded' or coalesce(new.refund_amount_completed, 0) <= 0) then
    select id into v_ledger from public.order_manual_refunds
    where source = 'workshop' and source_ref = new.id::text and status <> 'voided';
    if v_ledger is not null then
      perform public.void_refund_entry(v_ledger, 'Remboursement workshop annulé ou ramené à 0 dans le suivi workshop', 'system');
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_workshop_log_to_refunds on public.workshop_cancellation_log;
create trigger trg_workshop_log_to_refunds
  after insert or update of refund_status, refund_amount_completed, refund_amount_requested, postfinance_refund_id
  on public.workshop_cancellation_log
  for each row execute function public.trg_workshop_log_to_refunds();

do $$
declare f text;
begin
  foreach f in array array['trg_refund_ledger_cashback()', 'trg_order_refunds_to_ledger()', 'trg_workshop_log_to_refunds()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── 5. Reprise des données existantes (tests, rien n'est supprimé) ───────
-- 5a. Décisions workshop (une par annulation, clé = id de l'annulation).
do $$
declare r record;
begin
  for r in select id from public.workshop_cancellation_log where refund_amount_requested > 0 order by created_at loop
    perform public.sync_workshop_cancel_decision(r.id);
  end loop;
end $$;

-- 5b. refund_due_amount, plafonné au disponible (anomalie si réduit).
do $$
declare r record;
begin
  for r in select id, refund_due_amount from public.orders where refund_due_amount > 0 order by created_at loop
    perform public.record_refund_decision(
      p_order_id => r.id, p_amount => r.refund_due_amount,
      p_reason => 'Repris de orders.refund_due_amount', p_source => 'legacy_due',
      p_by => 'migration', p_source_ref => r.id::text, p_on_excess => 'clamp');
  end loop;
end $$;

-- 5c. « À rembourser » sans montant : décision = disponible restant, jamais plus.
do $$
declare r record; v_room numeric;
begin
  for r in
    select o.id from public.orders o
    where o.refund_status in ('to_refund', 'refunded')
      and coalesce(o.refund_due_amount, 0) = 0
      and not exists (select 1 from public.order_refund_decisions d where d.source = 'legacy_due' and d.source_ref = o.id::text)
    order by o.created_at
  loop
    v_room := public.order_collected_amount(r.id) - public.order_decided_amount(r.id);
    if v_room > 0 then
      perform public.record_refund_decision(
        p_order_id => r.id, p_amount => v_room,
        p_reason => 'Repris de orders.refund_status (montant non renseigné : solde encaissé non encore décidé)',
        p_source => 'legacy_due', p_by => 'migration', p_source_ref => r.id::text, p_on_excess => 'clamp');
    end if;
  end loop;
end $$;

-- 5d. Saisies admin existantes : couverture par une décision automatique si besoin.
do $$
declare r record;
begin
  for r in select id from public.order_manual_refunds where status = 'counted' order by created_at loop
    perform public.refresh_auto_refund_decision(r.id, 'migration');
  end loop;
end $$;

-- 5e. Lignes Make existantes (order_refunds), dans l'ordre chronologique.
-- completed_at = created_at → date non envoyée (« à dater ») ;
-- completed_at > created_at → probablement l'heure d'un rejeu sans date :
--   « à dater » + anomalie, plutôt qu'une date supposée.
do $$
declare r record;
begin
  for r in select * from public.order_refunds where status = 'successful' order by created_at loop
    if r.completed_at > r.created_at then
      insert into public.refund_anomalies (order_id, kind, source, source_ref, detail)
      values (r.order_id, 'date_make_ambigue', 'make_notion', r.postfinance_refund_id,
              format('Date %s postérieure à l''enregistrement %s : probablement l''heure d''un rejeu sans date. Ligne laissée « à dater ».',
                     r.completed_at, r.created_at))
      on conflict do nothing;
    end if;
    perform public.ingest_refund(
      p_order_id => r.order_id, p_amount => r.amount,
      p_refunded_at => case when r.completed_at >= r.created_at then null else r.completed_at end,
      p_source => 'make_notion', p_source_ref => r.postfinance_refund_id,
      p_reference => r.postfinance_refund_id, p_note => 'Repris de order_refunds',
      p_item_ids => case when r.order_item_id is not null then array[r.order_item_id] end,
      p_created_by => 'migration');
  end loop;
end $$;

-- 5f. Remboursements workshop déjà confirmés (« à dater »).
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
      p_order_id => r.order_id, p_amount => r.refund_amount_completed, p_refunded_at => null,
      p_source => 'workshop', p_source_ref => r.id::text, p_reference => r.postfinance_refund_id,
      p_note => 'Repris du suivi workshop', p_item_ids => array[r.order_item_id], p_created_by => 'migration');
  end loop;
end $$;

-- ── 6. Recalcul du cashback de chaque commande (idempotent) ──────────────
do $$
declare r record;
begin
  for r in select distinct order_id from public.reward_transactions where type = 'earned' and order_id is not null loop
    perform public.recompute_order_cashback(r.order_id);
  end loop;
end $$;

commit;
