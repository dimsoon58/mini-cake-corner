-- F33 : ateliers Piping + champ theme pour les sessions spéciales
-- (Halloween, Noël…). Ajoute le type « piping » partout où 'signature'
-- et 'paint' sont contraints, et un champ theme nullable sur les sessions.

-- ── 1. Élargir les CHECK sur workshop_sessions ───────────────────────────
alter table public.workshop_sessions
  drop constraint if exists workshop_sessions_workshop_type_check;
alter table public.workshop_sessions
  add constraint workshop_sessions_workshop_type_check
    check (workshop_type in ('signature', 'paint', 'piping'));

-- ── 2. Champ theme ────────────────────────────────────────────────────────
alter table public.workshop_sessions
  add column if not exists theme text check (length(theme) <= 80);

-- ── 3. Élargir le CHECK sur workshop_reservations ────────────────────────
alter table public.workshop_reservations
  drop constraint if exists workshop_reservations_workshop_type_check;
alter table public.workshop_reservations
  add constraint workshop_reservations_workshop_type_check
    check (workshop_type in ('signature', 'paint', 'piping'));

-- ── 4. Élargir le CHECK sur workshop_production_settings ─────────────────
alter table public.workshop_production_settings
  drop constraint if exists workshop_production_settings_pkey;
-- Recrée sans le CHECK sur workshop_type (la clé primaire l'implique seule)
-- On supprime l'ancienne contrainte inline et on insère piping.
-- La table n'a pas de contrainte nommée séparée sur workshop_type,
-- le primary key est suffisant : on ajoute juste la ligne piping.
insert into public.workshop_production_settings (workshop_type, cakes_per_participant, product_category, updated_by)
values ('piping', 1, 'bento_round', 'F33')
on conflict (workshop_type) do nothing;

-- Recréer la primary key (dropped above would error if on same table,
-- so we do it conditionally)
alter table public.workshop_production_settings
  add constraint workshop_production_settings_pkey primary key (workshop_type)
    deferrable initially deferred;

-- ── 5. admin_workshop_sessions() — inclut theme ──────────────────────────
create or replace function public.admin_workshop_sessions()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'time'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'type', s.workshop_type, 'date', s.workshop_date, 'time', s.workshop_time,
      'unitPrice', s.unit_price, 'capacity', s.max_capacity, 'isOpen', s.is_open,
      'theme', s.theme,
      'updatedAt', s.updated_at,
      'occupied', coalesce(r.occupied, 0), 'remaining', greatest(s.max_capacity - coalesce(r.occupied, 0), 0),
      'reservations', coalesce(r.n, 0), 'cancelledSeats', coalesce(r.cancelled, 0)) as x
    from public.workshop_sessions s
    left join (select workshop_session_id, count(*) filter (where status in ('pending', 'confirmed', 'partially_cancelled')) as n,
                      sum(purchased_seats - cancelled_seats) filter (where status in ('pending', 'confirmed', 'partially_cancelled')) as occupied,
                      sum(cancelled_seats) as cancelled
               from public.workshop_reservations group by workshop_session_id) r on r.workshop_session_id = s.id
  ) t;
$$;

-- ── 6. admin_workshop_session_save() — piping + theme ────────────────────
create or replace function public.admin_workshop_session_save(
  p_id text, p_type text, p_date date, p_time text, p_price numeric,
  p_capacity integer, p_open boolean, p_confirm boolean, p_by text,
  p_theme text default null)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_old public.workshop_sessions%rowtype;
  v_occupied integer := 0;
  v_reservations integer := 0;
  v_id text := nullif(btrim(p_id), '');
  v_row public.workshop_sessions%rowtype;
  v_theme text := nullif(btrim(coalesce(p_theme, '')), '');
begin
  if p_type not in ('signature', 'paint', 'piping') then raise exception 'Type de workshop inconnu' using errcode = 'P0001'; end if;
  if p_date is null then raise exception 'Date obligatoire' using errcode = 'P0001'; end if;
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Heure invalide (HH:MM)' using errcode = 'P0001'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Prix par personne obligatoire et positif' using errcode = 'P0001'; end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 100 then raise exception 'Capacité invalide (1 à 100)' using errcode = 'P0001'; end if;

  if v_id is not null then
    select * into v_old from public.workshop_sessions where id = v_id for update;
    if not found then raise exception 'Session introuvable' using errcode = 'P0002'; end if;
    select coalesce(sum(purchased_seats - cancelled_seats), 0), count(*) into v_occupied, v_reservations
      from public.workshop_reservations where workshop_session_id = v_id and status in ('pending', 'confirmed', 'partially_cancelled');
    if p_capacity < v_occupied then
      raise exception 'Capacité trop basse : % place(s) déjà occupée(s)', v_occupied using errcode = 'P0001';
    end if;
    if p_type <> v_old.workshop_type and v_reservations > 0 then
      raise exception 'Le type ne peut pas changer : % réservation(s) existent', v_reservations using errcode = 'P0001';
    end if;
    if exists (select 1 from public.workshop_sessions where id <> v_id and workshop_type = p_type and workshop_date = p_date and workshop_time = p_time) then
      raise exception 'Une autre session de ce type existe déjà à cette date et cette heure' using errcode = 'P0001';
    end if;
    if v_reservations > 0 and (p_date <> v_old.workshop_date or p_time <> v_old.workshop_time) and not coalesce(p_confirm, false) then
      return jsonb_build_object('needsConfirm', true, 'reservations', v_reservations, 'occupied', v_occupied,
        'message', format('%s réservation(s) (%s place(s)) existent : changer la date ou l''heure ne prévient personne automatiquement.', v_reservations, v_occupied));
    end if;
    update public.workshop_sessions
       set workshop_type = p_type, workshop_date = p_date, workshop_time = p_time, unit_price = round(p_price, 2),
           max_capacity = p_capacity, is_open = coalesce(p_open, v_old.is_open),
           theme = v_theme, updated_at = now()
     where id = v_id returning * into v_row;
    insert into public.workshop_session_audit (session_id, action, before, after, actor) values (v_id, 'update', to_jsonb(v_old), to_jsonb(v_row), p_by);
  else
    if exists (select 1 from public.workshop_sessions where workshop_type = p_type and workshop_date = p_date and workshop_time = p_time) then
      raise exception 'Une session de ce type existe déjà à cette date et cette heure' using errcode = 'P0001';
    end if;
    v_id := (case p_type when 'signature' then 'sig' when 'piping' then 'piping' else 'paint' end)
            || '-' || to_char(p_date, 'YYYY-MM-DD');
    if exists (select 1 from public.workshop_sessions where id = v_id) then v_id := v_id || '-' || replace(p_time, ':', ''); end if;
    if exists (select 1 from public.workshop_sessions where id = v_id) then
      raise exception 'Une session de ce type existe déjà à cette date et cette heure' using errcode = 'P0001';
    end if;
    insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open, theme)
    values (v_id, p_type, p_date, p_time, round(p_price, 2), p_capacity, coalesce(p_open, true), v_theme) returning * into v_row;
    insert into public.workshop_session_audit (session_id, action, before, after, actor) values (v_id, 'create', null, to_jsonb(v_row), p_by);
  end if;
  return jsonb_build_object('needsConfirm', false, 'session', to_jsonb(v_row));
end;
$$;

-- ── 7. get_workshop_availability() — inclut theme ────────────────────────
create or replace function public.get_workshop_availability()
returns table (
  id                    text,
  workshop_type         text,
  workshop_date         date,
  workshop_time         text,
  unit_price            numeric,
  max_capacity          integer,
  is_open               boolean,
  theme                 text,
  active_reserved_seats integer,
  remaining_seats       integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.id,
    s.workshop_type,
    s.workshop_date,
    s.workshop_time,
    s.unit_price,
    s.max_capacity,
    s.is_open,
    s.theme,
    coalesce(r.occupied, 0)::int                               as active_reserved_seats,
    greatest(s.max_capacity - coalesce(r.occupied, 0), 0)::int as remaining_seats
  from public.workshop_sessions s
  left join (
    select workshop_session_id,
           sum(purchased_seats - cancelled_seats) as occupied
    from public.workshop_reservations
    where status in ('pending', 'confirmed', 'partially_cancelled')
    group by workshop_session_id
  ) r on r.workshop_session_id = s.id
  order by s.workshop_date, s.workshop_time;
$$;

revoke all on function public.get_workshop_availability() from public;
grant execute on function public.get_workshop_availability() to anon, authenticated, service_role;

-- ── 8. Sessions — Octobre / Novembre / Décembre 2026 ─────────────────────
insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open, theme) values
  -- 28 oct (Halloween)
  ('paint-2026-10-28',   'paint',     date '2026-10-28', '16:00',  65, 10, true, 'Halloween'),
  ('piping-2026-10-28',  'piping',    date '2026-10-28', '18:00',  85,  8, true, 'Halloween'),
  -- 4 nov
  ('paint-2026-11-04',   'paint',     date '2026-11-04', '16:00',  65, 10, true, null),
  ('piping-2026-11-04',  'piping',    date '2026-11-04', '19:00',  85,  8, true, null),
  -- 11 nov
  ('paint-2026-11-11',   'paint',     date '2026-11-11', '16:00',  65, 10, true, null),
  ('piping-2026-11-11',  'piping',    date '2026-11-11', '19:00',  85,  8, true, null),
  -- 18 nov
  ('paint-2026-11-18',   'paint',     date '2026-11-18', '16:00',  65, 10, true, null),
  ('piping-2026-11-18',  'piping',    date '2026-11-18', '19:00',  85,  8, true, null),
  -- Décembre (Noël)
  ('sig-2026-12-05',     'signature', date '2026-12-05', '14:00', 120,  8, true, 'Noël'),
  ('piping-2026-12-16',  'piping',    date '2026-12-16', '18:00',  85,  8, true, 'Noël'),
  ('sig-2026-12-19',     'signature', date '2026-12-19', '14:00', 120,  8, true, 'Noël')
on conflict (id) do nothing;
