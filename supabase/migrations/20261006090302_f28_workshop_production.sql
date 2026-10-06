-- F28 — Gâteaux des workshops dans la production et le stock (06.10.2026).
--
-- À appliquer après F15 (stock ↔ production) et F24 (sessions). Additive,
-- relançable. Service role uniquement. Ne touche ni aux paiements, ni aux
-- commandes, ni aux réservations existantes, ni à Make.
--
-- Règles (validées par Mel le 06.10.2026) :
--   * Par type d'atelier : N gâteaux par participant, d'une catégorie donnée
--     (par défaut 1 Bento rond, Signature et Peinture), génoise = choix du
--     participant (vanille / chocolat).
--   * Production regroupée PAR SESSION : besoin par génoise = places
--     réellement confirmées × N (calculé par la fonction Edge, même code que
--     la page Production, et passé ici en p_needed sous verrou).
--   * Préparation partielle possible, par génoise : plusieurs lots par
--     session. « Pris dans le stock » retire les gâteaux disponibles (le
--     reste est préparé frais, jamais sous 0) ; « Préparé frais » ne retire
--     rien. Mêmes règles et même journal que F15.
--   * Jamais plus que le besoin : un lot est refusé s'il dépasse
--     « besoin − déjà préparé (net) ». Nouvelle réservation après
--     préparation : seul le complément reste à préparer.
--   * Places annulées après préparation : les gâteaux en trop sont signalés ;
--     décision explicite « réutilisable » (remise en stock) ou « perdu »,
--     au plus le surplus, jamais automatique.
--   * Annuler un lot (« décocher ») ne remet rien en stock tout seul : une
--     restitution (au plus ce qui a été retiré du stock) peut être notée,
--     une seule fois.
--   * Génoise d'une place annulée : notée à l'annulation (obligatoire quand
--     la réservation mélange vanille et chocolat, depuis l'admin) ; sinon
--     la place reste « à confirmer », jamais devinée.

begin;

-- ── Réglages par type d'atelier ──────────────────────────────────────────
create table if not exists public.workshop_production_settings (
  workshop_type          text primary key check (workshop_type in ('signature', 'paint')),
  cakes_per_participant  integer not null default 1 check (cakes_per_participant between 0 and 10),
  product_category       text not null default 'bento_round'
    check (product_category in ('bento_round', 'bento_heart', 'medium_round', 'medium_heart', 'large_round', 'large_heart', 'rectangle', 'dot_cake')),
  updated_at             timestamptz not null default now(),
  updated_by             text
);
insert into public.workshop_production_settings (workshop_type, cakes_per_participant, product_category, updated_by)
values ('signature', 1, 'bento_round', 'F28'), ('paint', 1, 'bento_round', 'F28')
on conflict (workshop_type) do nothing;

create or replace function public.workshop_production_setting_save(p_type text, p_cakes integer, p_category text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_old public.workshop_production_settings; v_new public.workshop_production_settings;
begin
  select * into v_old from public.workshop_production_settings where workshop_type = p_type for update;
  if not found then raise exception 'Type d''atelier inconnu' using errcode = 'P0002'; end if;
  if p_cakes is null or p_cakes < 0 or p_cakes > 10 then raise exception 'Nombre de gâteaux invalide (0 à 10)' using errcode = 'P0001'; end if;
  update public.workshop_production_settings
     set cakes_per_participant = p_cakes, product_category = p_category, updated_at = now(), updated_by = p_by
   where workshop_type = p_type returning * into v_new;
  insert into public.workshop_session_audit (session_id, action, before, after, actor)
  values ('production:' || p_type, 'update', to_jsonb(v_old), to_jsonb(v_new), p_by);
  return to_jsonb(v_new);
end $$;

-- ── Génoise des places annulées ──────────────────────────────────────────
create table if not exists public.workshop_sponge_cancellations (
  id               uuid primary key default gen_random_uuid(),
  reservation_id   uuid not null references public.workshop_reservations(id),
  idempotency_key  text not null unique,
  vanilla          integer not null default 0 check (vanilla >= 0),
  chocolate        integer not null default 0 check (chocolate >= 0),
  created_at       timestamptz not null default now(),
  created_by       text,
  constraint workshop_sponge_cancellations_some check (vanilla + chocolate > 0)
);
create index if not exists workshop_sponge_cancellations_res_idx on public.workshop_sponge_cancellations (reservation_id);

-- Rejouable (même clé = rien de plus). Jamais plus que les places annulées,
-- ni plus que les participants de cette génoise.
create or replace function public.workshop_record_cancelled_sponges(
  p_reservation uuid, p_key text, p_vanilla integer, p_chocolate integer, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_res public.workshop_reservations;
  v_choices text[];
  v_rec_v integer; v_rec_c integer;
  v_row public.workshop_sponge_cancellations;
begin
  select * into v_row from public.workshop_sponge_cancellations where idempotency_key = p_key;
  if found then return jsonb_build_object('replayed', true, 'row', to_jsonb(v_row)); end if;
  if coalesce(p_vanilla, 0) < 0 or coalesce(p_chocolate, 0) < 0 or coalesce(p_vanilla, 0) + coalesce(p_chocolate, 0) = 0 then
    raise exception 'Génoises annulées invalides' using errcode = 'P0001';
  end if;
  select * into v_res from public.workshop_reservations where id = p_reservation for update;
  if not found then raise exception 'Réservation introuvable' using errcode = 'P0002'; end if;
  select coalesce(workshop_sponge_choices, '{}') into v_choices from public.order_items where id = v_res.order_item_id;
  select coalesce(sum(vanilla), 0), coalesce(sum(chocolate), 0) into v_rec_v, v_rec_c
    from public.workshop_sponge_cancellations where reservation_id = p_reservation;
  if v_rec_v + v_rec_c + p_vanilla + p_chocolate > v_res.cancelled_seats then
    raise exception 'Plus de génoises que de places annulées' using errcode = 'P0001';
  end if;
  if v_rec_v + p_vanilla > (select count(*) from unnest(v_choices) c where c = 'vanilla')
     or v_rec_c + p_chocolate > (select count(*) from unnest(v_choices) c where c = 'chocolate') then
    raise exception 'Plus de génoises annulées que de participants avec cette génoise' using errcode = 'P0001';
  end if;
  insert into public.workshop_sponge_cancellations (reservation_id, idempotency_key, vanilla, chocolate, created_by)
  values (p_reservation, p_key, p_vanilla, p_chocolate, p_by) returning * into v_row;
  return jsonb_build_object('replayed', false, 'row', to_jsonb(v_row));
end $$;

create or replace function public.workshop_cancelled_sponges(p_reservations uuid[])
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_object_agg(reservation_id, jsonb_build_object('vanilla', v, 'chocolate', c)), '{}'::jsonb)
  from (select reservation_id, sum(vanilla)::int v, sum(chocolate)::int c
        from public.workshop_sponge_cancellations where reservation_id = any(p_reservations) group by reservation_id) x;
$$;

-- ── Lots préparés par session ────────────────────────────────────────────
create table if not exists public.workshop_preparations (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null references public.workshop_sessions(id),
  sponge_base   text not null check (sponge_base in ('vanilla', 'chocolate')),
  category      text not null,
  units         integer not null check (units > 0),
  mode          text not null check (mode in ('stock', 'fresh')),
  taken_units   integer not null default 0 check (taken_units >= 0),
  fresh_units   integer not null default 0 check (fresh_units >= 0),
  prepared_at   timestamptz not null default now(),
  prepared_by   text,
  undone_at     timestamptz,
  undone_by     text,
  undo_note     text,
  returned_units integer,
  constraint workshop_preparations_split check (taken_units + fresh_units = units)
);
create index if not exists workshop_preparations_session_idx on public.workshop_preparations (session_id) where undone_at is null;

create table if not exists public.workshop_surplus_decisions (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null references public.workshop_sessions(id),
  sponge_base  text not null check (sponge_base in ('vanilla', 'chocolate')),
  category     text not null,
  units        integer not null check (units > 0),
  decision     text not null check (decision in ('reusable', 'lost')),
  decided_at   timestamptz not null default now(),
  decided_by   text,
  note         text
);
create index if not exists workshop_surplus_decisions_session_idx on public.workshop_surplus_decisions (session_id);

-- Mouvements de stock d'un workshop : même journal, avec la session.
alter table public.production_stock_movements add column if not exists workshop_session_id text;

create or replace function public.workshop_stock_move(
  p_base text, p_category text, p_delta integer, p_kind text, p_by text, p_preparation uuid, p_session text, p_note text)
returns integer language plpgsql set search_path to '' as $$
declare v_q integer;
begin
  perform 1 from public.production_units_list(jsonb_build_array(jsonb_build_object('base', p_base, 'category', p_category, 'units', 1)));
  insert into public.production_stock (sponge_base, product_category, quantity, updated_by)
  values (p_base, p_category, 0, p_by)
  on conflict (sponge_base, product_category) do nothing;
  select quantity into v_q from public.production_stock
   where sponge_base = p_base and product_category = p_category for update;
  if v_q + p_delta < 0 then raise exception 'Stock insuffisant' using errcode = 'P0001'; end if;
  update public.production_stock set quantity = v_q + p_delta, updated_at = now(), updated_by = p_by
   where sponge_base = p_base and product_category = p_category;
  insert into public.production_stock_movements (created_by, sponge_base, product_category, delta, quantity_after, kind, preparation_id, order_item_id, note, workshop_session_id)
  values (p_by, p_base, p_category, p_delta, v_q + p_delta, p_kind, p_preparation, null, p_note, p_session);
  return v_q + p_delta;
end $$;

-- Net déjà préparé pour une génoise d'une session (lots actifs − surplus décidé).
create or replace function public.workshop_net_prepared(p_session text, p_base text)
returns integer language sql stable set search_path to '' as $$
  select coalesce((select sum(units) from public.workshop_preparations where session_id = p_session and sponge_base = p_base and undone_at is null), 0)::int
       - coalesce((select sum(units) from public.workshop_surplus_decisions where session_id = p_session and sponge_base = p_base), 0)::int;
$$;

-- Un lot préparé. p_needed = besoin total de cette génoise pour la session
-- (places confirmées × gâteaux par participant), calculé par la fonction Edge.
create or replace function public.workshop_mark_prepared(
  p_session text, p_base text, p_category text, p_units integer, p_needed integer, p_mode text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_net integer;
  v_avail integer;
  v_take integer := 0;
  v_prep public.workshop_preparations;
begin
  if p_mode not in ('stock', 'fresh') then raise exception 'Mode invalide' using errcode = 'P0001'; end if;
  if p_base not in ('vanilla', 'chocolate') then raise exception 'Génoise invalide' using errcode = 'P0001'; end if;
  if p_units is null or p_units < 1 then raise exception 'Quantité invalide' using errcode = 'P0001'; end if;
  perform 1 from public.production_units_list(jsonb_build_array(jsonb_build_object('base', p_base, 'category', p_category, 'units', 1)));
  perform 1 from public.workshop_sessions where id = p_session for update;   -- un lot à la fois par session
  if not found then raise exception 'Session introuvable' using errcode = 'P0002'; end if;
  v_net := public.workshop_net_prepared(p_session, p_base);
  if p_units > greatest(coalesce(p_needed, 0) - v_net, 0) then
    raise exception 'Au plus % gâteau(x) encore à préparer pour cette génoise', greatest(coalesce(p_needed, 0) - v_net, 0) using errcode = 'P0001';
  end if;
  if p_mode = 'stock' then
    select quantity into v_avail from public.production_stock where sponge_base = p_base and product_category = p_category for update;
    v_take := least(p_units, coalesce(v_avail, 0));
    if v_take > 0 then
      perform public.workshop_stock_move(p_base, p_category, -v_take, 'order_use', p_by, v_id, p_session, null);
    end if;
  end if;
  insert into public.workshop_preparations (id, session_id, sponge_base, category, units, mode, taken_units, fresh_units, prepared_by)
  values (v_id, p_session, p_base, p_category, p_units, p_mode, v_take, p_units - v_take, p_by)
  returning * into v_prep;
  return to_jsonb(v_prep);
end $$;

-- Annuler un lot (« décocher »). Rien n'est remis en stock sans p_return
-- (au plus ce qui a été retiré du stock pour ce lot), une seule fois.
create or replace function public.workshop_unprepare(p_preparation uuid, p_return integer, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_prep public.workshop_preparations;
begin
  select * into v_prep from public.workshop_preparations where id = p_preparation for update;
  if not found then raise exception 'Lot introuvable' using errcode = 'P0002'; end if;
  if v_prep.undone_at is not null then raise exception 'Ce lot est déjà annulé' using errcode = 'P0001'; end if;
  perform 1 from public.workshop_sessions where id = v_prep.session_id for update;
  if coalesce(p_return, 0) < 0 or coalesce(p_return, 0) > v_prep.taken_units then
    raise exception 'On ne peut remettre que ce qui a été retiré du stock (% au plus)', v_prep.taken_units using errcode = 'P0001';
  end if;
  if public.workshop_net_prepared(v_prep.session_id, v_prep.sponge_base) - v_prep.units < 0 then
    raise exception 'Des gâteaux en trop de ce lot ont déjà été déclarés réutilisables ou perdus' using errcode = 'P0001';
  end if;
  if coalesce(p_return, 0) > 0 then
    perform public.workshop_stock_move(v_prep.sponge_base, v_prep.category, p_return, 'return_uncheck', p_by, v_prep.id, v_prep.session_id, nullif(btrim(coalesce(p_note, '')), ''));
  end if;
  update public.workshop_preparations
     set undone_at = now(), undone_by = p_by, undo_note = nullif(btrim(coalesce(p_note, '')), ''), returned_units = nullif(coalesce(p_return, 0), 0)
   where id = v_prep.id returning * into v_prep;
  return to_jsonb(v_prep);
end $$;

-- Gâteaux en trop après annulation de places : « réutilisable » (remis en
-- stock) ou « perdu ». Au plus le surplus (net préparé − besoin).
create or replace function public.workshop_surplus_decide(
  p_session text, p_base text, p_category text, p_units integer, p_needed integer, p_reusable boolean, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_surplus integer; v_row public.workshop_surplus_decisions; v_id uuid := gen_random_uuid();
begin
  if p_base not in ('vanilla', 'chocolate') then raise exception 'Génoise invalide' using errcode = 'P0001'; end if;
  if p_units is null or p_units < 1 then raise exception 'Quantité invalide' using errcode = 'P0001'; end if;
  perform 1 from public.workshop_sessions where id = p_session for update;
  if not found then raise exception 'Session introuvable' using errcode = 'P0002'; end if;
  v_surplus := public.workshop_net_prepared(p_session, p_base) - coalesce(p_needed, 0);
  if p_units > greatest(v_surplus, 0) then
    raise exception 'Au plus % gâteau(x) en trop pour cette génoise', greatest(v_surplus, 0) using errcode = 'P0001';
  end if;
  if p_reusable then
    perform public.workshop_stock_move(p_base, p_category, p_units, 'return_cancelled', p_by, v_id, p_session, nullif(btrim(coalesce(p_note, '')), ''));
  end if;
  insert into public.workshop_surplus_decisions (id, session_id, sponge_base, category, units, decision, decided_by, note)
  values (v_id, p_session, p_base, p_category, p_units, case when p_reusable then 'reusable' else 'lost' end, p_by, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- État de production des sessions demandées (lots actifs + surplus décidés).
create or replace function public.workshop_production_state(p_sessions text[])
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'preparations', coalesce((select jsonb_agg(to_jsonb(p) order by p.prepared_at)
                              from public.workshop_preparations p where p.session_id = any(p_sessions) and p.undone_at is null), '[]'::jsonb),
    'surplus', coalesce((select jsonb_agg(to_jsonb(d) order by d.decided_at)
                         from public.workshop_surplus_decisions d where d.session_id = any(p_sessions)), '[]'::jsonb),
    'settings', coalesce((select jsonb_object_agg(workshop_type, jsonb_build_object('cakesPerParticipant', cakes_per_participant, 'category', product_category))
                          from public.workshop_production_settings), '{}'::jsonb)
  );
$$;

-- Journal affiché sur la page Production : les mouvements des workshops
-- montrent leur session (mêmes colonnes qu'avant + workshop_session_id).
create or replace function public.production_recent_movements(p_limit integer)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.created_at, m.created_by, m.sponge_base, m.product_category, m.delta, m.quantity_after, m.kind, m.note,
           o.order_number, m.workshop_session_id
    from public.production_stock_movements m
    left join public.order_items i on i.id = m.order_item_id
    left join public.orders o on o.id = i.order_id
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 200)
  ) x;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['workshop_production_settings', 'workshop_sponge_cancellations', 'workshop_preparations', 'workshop_surplus_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'workshop_production_setting_save(text, integer, text, text)',
    'workshop_record_cancelled_sponges(uuid, text, integer, integer, text)',
    'workshop_cancelled_sponges(uuid[])',
    'workshop_stock_move(text, text, integer, text, text, uuid, text, text)',
    'workshop_net_prepared(text, text)',
    'workshop_mark_prepared(text, text, text, integer, integer, text, text)',
    'workshop_unprepare(uuid, integer, text, text)',
    'workshop_surplus_decide(text, text, text, integer, integer, boolean, text, text)',
    'workshop_production_state(text[])',
    'production_recent_movements(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
