-- F9 — Planning équipe (lot E) : horaires prévus et réalisés de Nahya,
-- vacances et absences de Nahya, Élie et Melodie, paramètres de contrat.
--
-- Indépendant des commandes, paiements et remboursements (rien n'y est lu ni
-- modifié). Aucune dépendance à Make ou Notion. Service_role uniquement : tout
-- passe par l'Edge Function team-planning (session admin).
--
-- Durées en MINUTES (entiers). Les calculs (objectif de la semaine, crédits
-- d'absence, décompte des vacances, soldes) sont faits par
-- supabase/functions/_shared/team-hours.ts à partir de ces données ; la base
-- garantit les règles dures (dates, chevauchements, doublons) et l'historique.
--
-- Historique : aucune suppression physique (deleted_at / deleted_by) et un
-- journal team_audit (avant / après / auteur) sur toutes les tables.
--
-- Additive, relançable.

begin;

-- ── Personnes ────────────────────────────────────────────────────────────
create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,
  color        text not null,
  tracks_hours boolean not null default false,   -- horaires + compteur d'heures
  tracks_leave boolean not null default false,   -- compteur de droits aux vacances
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ── Périodes de contrat (une prolongation = une nouvelle période) ────────
create table if not exists public.team_contracts (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid not null references public.team_members(id),
  label                 text,
  start_date            date not null,
  end_date              date not null,
  rate_pct              numeric(5,2) not null,
  weekly_target_min     integer not null check (weekly_target_min >= 0),
  leave_entitlement_min integer not null check (leave_entitlement_min >= 0),
  leave_day_min         integer not null check (leave_day_min >= 0),
  leave_half_day_min    integer not null check (leave_half_day_min >= 0),
  leave_week_min        integer not null check (leave_week_min >= 0),
  -- Répartition de référence par jour ISO (1 = lundi … 7 = dimanche), en
  -- minutes. Indépendante du planning saisi.
  reference_schedule    jsonb not null,
  saturday_can_replace  boolean not null default true,
  -- Réglages à confirmer avec le fiduciaire (voir le document du lot) :
  holiday_reduces_target boolean not null default true,  -- férié sur un jour de référence : objectif réduit
  absence_credit_basis  text not null default 'reference'
                        check (absence_credit_basis in ('reference', 'planned', 'leave_day')),
  notes                 text,
  created_by            text,
  updated_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            text,
  constraint team_contracts_dates_check check (end_date >= start_date)
);

-- ── Horaires prévus ──────────────────────────────────────────────────────
create table if not exists public.team_schedule_slots (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.team_members(id),
  work_date   date not null,
  start_time  time not null,
  end_time    time not null,
  break_min   integer not null default 0 check (break_min >= 0),
  note        text,
  copied_from uuid,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text,
  constraint team_slots_time_check check (end_time > start_time)
);
create index if not exists team_slots_member_date_idx on public.team_schedule_slots (member_id, work_date) where deleted_at is null;

-- ── Heures réellement effectuées (séparées du prévu) ─────────────────────
create table if not exists public.team_work_logs (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.team_members(id),
  work_date   date not null,
  start_time  time not null,
  end_time    time not null,
  break_min   integer not null default 0 check (break_min >= 0),
  note        text,
  from_slot   uuid,      -- renseigné par « Réalisé comme prévu »
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text,
  constraint team_logs_time_check check (end_time > start_time)
);
create index if not exists team_logs_member_date_idx on public.team_work_logs (member_id, work_date) where deleted_at is null;

-- ── Vacances et absences ─────────────────────────────────────────────────
-- kind : vacation | sick | accident | other | employer_reduction (réduction
-- d'horaire décidée par l'employeur, jamais un manque de l'employée).
-- portion : full | am | pm (demi-journée seulement sur un seul jour).
create table if not exists public.team_absences (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.team_members(id),
  kind        text not null check (kind in ('vacation', 'sick', 'accident', 'other', 'employer_reduction')),
  start_date  date not null,
  end_date    date not null,
  portion     text not null default 'full' check (portion in ('full', 'am', 'pm')),
  note        text,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text,
  constraint team_absences_dates_check check (end_date >= start_date),
  constraint team_absences_half_day_check check (portion = 'full' or start_date = end_date)
);
create index if not exists team_absences_member_idx on public.team_absences (member_id, start_date, end_date) where deleted_at is null;

-- ── Jour explicitement « non travaillé » (ex. lundi remplacé par samedi) ─
create table if not exists public.team_day_marks (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.team_members(id),
  mark_date   date not null,
  kind        text not null default 'off' check (kind in ('off')),
  note        text,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text
);
create unique index if not exists team_day_marks_once_uidx on public.team_day_marks (member_id, mark_date) where deleted_at is null;

-- ── Jours fériés reconnus (modifiables) ──────────────────────────────────
create table if not exists public.team_holidays (
  holiday_date date primary key,
  label        text not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);

-- ── Historique ───────────────────────────────────────────────────────────
create table if not exists public.team_audit (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  actor      text,
  created_at timestamptz not null default now()
);
create index if not exists team_audit_row_idx on public.team_audit (table_name, row_id, created_at);

create or replace function public.trg_team_audit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_action text := lower(tg_op);
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then v_action := 'delete'; end if;
  insert into public.team_audit (table_name, row_id, action, before, after, actor)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'holiday_date'), v_action,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
          coalesce(v_row ->> 'deleted_by', v_row ->> 'updated_by', v_row ->> 'created_by'));
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['team_contracts', 'team_schedule_slots', 'team_work_logs', 'team_absences', 'team_day_marks', 'team_holidays'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_team_audit()', t);
  end loop;
end $$;

-- ── Aides ────────────────────────────────────────────────────────────────
create or replace function public.team_member_id(p_slug text)
returns uuid language sql stable set search_path to '' as $$
  select id from public.team_members where slug = p_slug;
$$;

create or replace function public.team_contract_on(p_member uuid, p_date date)
returns uuid language sql stable set search_path to '' as $$
  select id from public.team_contracts
  where member_id = p_member and deleted_at is null and p_date between start_date and end_date
  order by start_date desc limit 1;
$$;

create or replace function public.team_require_member(p_member uuid, p_hours boolean)
returns void language plpgsql stable set search_path to '' as $$
declare v public.team_members%rowtype;
begin
  select * into v from public.team_members where id = p_member and active;
  if not found then raise exception 'Personne inconnue' using errcode = 'P0002'; end if;
  if p_hours and not v.tracks_hours then
    raise exception 'Les horaires ne sont gérés que pour %', (select string_agg(display_name, ', ') from public.team_members where tracks_hours)
      using errcode = 'P0001';
  end if;
end;
$$;

-- ── Lecture ──────────────────────────────────────────────────────────────
-- Tout ce qu'il faut pour calculer la période [p_from ; p_to] : personnes,
-- contrats, horaires, réalisé, marques, fériés de la période ; absences et
-- réalisé de TOUTE la durée des contrats (pour les soldes cumulés), et tous
-- les jours fériés (liste courte, modifiable dans les réglages).
create or replace function public.team_planning_data(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with bounds as (
    select least(p_from, coalesce(min(start_date), p_from)) as a, greatest(p_to, coalesce(max(end_date), p_to)) as b
    from public.team_contracts where deleted_at is null
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'members', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.team_members m where m.active), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(to_jsonb(c) order by c.start_date) from public.team_contracts c where c.deleted_at is null), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(to_jsonb(s) order by s.work_date, s.start_time) from public.team_schedule_slots s, bounds
                       where s.deleted_at is null and s.work_date between bounds.a and bounds.b), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(to_jsonb(l) order by l.work_date, l.start_time) from public.team_work_logs l, bounds
                      where l.deleted_at is null and l.work_date between bounds.a and bounds.b), '[]'::jsonb),
    'absences', coalesce((select jsonb_agg(to_jsonb(x) order by x.start_date) from public.team_absences x, bounds
                          where x.deleted_at is null and x.end_date >= bounds.a and x.start_date <= bounds.b), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(to_jsonb(k) order by k.mark_date) from public.team_day_marks k, bounds
                       where k.deleted_at is null and k.mark_date between bounds.a and bounds.b), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(to_jsonb(h) order by h.holiday_date) from public.team_holidays h
                          where h.deleted_at is null), '[]'::jsonb)
  )
  from bounds;
$$;

create or replace function public.team_history(p_table text, p_row text)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after, 'actor', actor, 'at', created_at)
         order by created_at desc), '[]'::jsonb)
  from public.team_audit where table_name = p_table and row_id = p_row;
$$;

-- ── Horaires prévus ──────────────────────────────────────────────────────
create or replace function public.team_save_slot(
  p_id uuid, p_member uuid, p_date date, p_start time, p_end time, p_break int, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  perform public.team_require_member(p_member, true);
  if p_end <= p_start then raise exception 'L''heure de fin doit être après l''heure de début' using errcode = 'P0001'; end if;
  if coalesce(p_break, 0) < 0 or coalesce(p_break, 0) >= extract(epoch from (p_end - p_start)) / 60 then
    raise exception 'La pause doit être plus courte que le créneau' using errcode = 'P0001';
  end if;
  if public.team_contract_on(p_member, p_date) is null then
    raise exception 'Cette date est hors de la période du contrat' using errcode = 'P0001';
  end if;
  if extract(isodow from p_date) = 7 then
    raise exception 'Pas de travail le dimanche' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_schedule_slots s where s.member_id = p_member and s.work_date = p_date and s.deleted_at is null
             and s.id is distinct from p_id and s.start_time < p_end and p_start < s.end_time) then
    raise exception 'Ce créneau chevauche un autre créneau prévu le même jour' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.team_schedule_slots (member_id, work_date, start_time, end_time, break_min, note, created_by, updated_by)
    values (p_member, p_date, p_start, p_end, coalesce(p_break, 0), nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  else
    update public.team_schedule_slots
       set work_date = p_date, start_time = p_start, end_time = p_end, break_min = coalesce(p_break, 0),
           note = nullif(btrim(p_note), ''), updated_by = p_by, updated_at = now()
     where id = v_id and member_id = p_member and deleted_at is null;
    if not found then raise exception 'Créneau introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.team_delete_row(p_table text, p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
declare v_n int;
begin
  if p_table not in ('team_schedule_slots', 'team_work_logs', 'team_absences', 'team_day_marks', 'team_contracts') then
    raise exception 'Table inconnue' using errcode = 'P0001';
  end if;
  execute format('update public.%I set deleted_at = now(), deleted_by = $2, updated_by = $2, updated_at = now() where id = $1 and deleted_at is null', p_table)
    using p_id, p_by;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Élément introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

-- « Copier la semaine » : uniquement les horaires PRÉVUS de la semaine
-- source (jamais le réalisé ni les absences). Jours hors contrat ignorés.
-- Semaine cible déjà planifiée : refus, sauf p_replace (les anciens créneaux
-- sont supprimés logiquement, avec historique).
create or replace function public.team_copy_week(p_member uuid, p_source_monday date, p_target_monday date, p_replace boolean, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_offset int := p_target_monday - p_source_monday;
  v_copied int := 0;
  v_skipped int := 0;
  r record;
begin
  perform public.team_require_member(p_member, true);
  if extract(isodow from p_source_monday) <> 1 or extract(isodow from p_target_monday) <> 1 then
    raise exception 'Les semaines doivent commencer un lundi' using errcode = 'P0001';
  end if;
  if v_offset = 0 then raise exception 'Choisissez une autre semaine' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.team_schedule_slots where member_id = p_member and deleted_at is null
                 and work_date between p_source_monday and p_source_monday + 6) then
    raise exception 'La semaine source n''a aucun horaire prévu' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_schedule_slots where member_id = p_member and deleted_at is null
             and work_date between p_target_monday and p_target_monday + 6) then
    if not p_replace then
      raise exception 'La semaine cible a déjà des horaires prévus : confirmez le remplacement' using errcode = 'P0003';
    end if;
    update public.team_schedule_slots set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
     where member_id = p_member and deleted_at is null and work_date between p_target_monday and p_target_monday + 6;
  end if;
  for r in select * from public.team_schedule_slots where member_id = p_member and deleted_at is null
           and work_date between p_source_monday and p_source_monday + 6 order by work_date, start_time loop
    if public.team_contract_on(p_member, r.work_date + v_offset) is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.team_schedule_slots (member_id, work_date, start_time, end_time, break_min, note, copied_from, created_by, updated_by)
    values (p_member, r.work_date + v_offset, r.start_time, r.end_time, r.break_min, r.note, r.id, p_by, p_by);
    v_copied := v_copied + 1;
  end loop;
  return jsonb_build_object('copied', v_copied, 'skippedOutsideContract', v_skipped);
end;
$$;

-- ── Heures réalisées ─────────────────────────────────────────────────────
create or replace function public.team_save_log(
  p_id uuid, p_member uuid, p_date date, p_start time, p_end time, p_break int, p_note text, p_by text, p_today date)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  perform public.team_require_member(p_member, true);
  if p_date > p_today then raise exception 'On ne peut pas saisir des heures réalisées dans le futur' using errcode = 'P0001'; end if;
  if p_end <= p_start then raise exception 'L''heure de fin doit être après l''heure de début' using errcode = 'P0001'; end if;
  if coalesce(p_break, 0) < 0 or coalesce(p_break, 0) >= extract(epoch from (p_end - p_start)) / 60 then
    raise exception 'La pause doit être plus courte que le créneau' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_work_logs l where l.member_id = p_member and l.work_date = p_date and l.deleted_at is null
             and l.id is distinct from p_id and l.start_time < p_end and p_start < l.end_time) then
    raise exception 'Ces heures chevauchent d''autres heures saisies le même jour' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.team_work_logs (member_id, work_date, start_time, end_time, break_min, note, created_by, updated_by)
    values (p_member, p_date, p_start, p_end, coalesce(p_break, 0), nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  else
    update public.team_work_logs
       set work_date = p_date, start_time = p_start, end_time = p_end, break_min = coalesce(p_break, 0),
           note = nullif(btrim(p_note), ''), updated_by = p_by, updated_at = now()
     where id = v_id and member_id = p_member and deleted_at is null;
    if not found then raise exception 'Saisie introuvable' using errcode = 'P0002'; end if;
  end if;
  -- Un jour renseigné n'a plus besoin de la marque « non travaillé ».
  update public.team_day_marks set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where member_id = p_member and mark_date = p_date and deleted_at is null;
  return v_id;
end;
$$;

-- « Réalisé comme prévu » : recopie les créneaux prévus du jour en heures
-- réalisées, uniquement sur demande et si rien n'est encore saisi ce jour-là.
create or replace function public.team_realize_as_planned(p_member uuid, p_date date, p_by text, p_today date)
returns int language plpgsql set search_path to '' as $$
declare v_n int;
begin
  perform public.team_require_member(p_member, true);
  if p_date > p_today then raise exception 'On ne peut pas saisir des heures réalisées dans le futur' using errcode = 'P0001'; end if;
  if exists (select 1 from public.team_work_logs where member_id = p_member and work_date = p_date and deleted_at is null) then
    raise exception 'Des heures sont déjà saisies pour ce jour : modifiez-les directement' using errcode = 'P0001';
  end if;
  insert into public.team_work_logs (member_id, work_date, start_time, end_time, break_min, note, from_slot, created_by, updated_by)
  select member_id, work_date, start_time, end_time, break_min, 'Réalisé comme prévu', id, p_by, p_by
  from public.team_schedule_slots where member_id = p_member and work_date = p_date and deleted_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Aucun horaire prévu ce jour-là' using errcode = 'P0001'; end if;
  update public.team_day_marks set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where member_id = p_member and mark_date = p_date and deleted_at is null;
  return v_n;
end;
$$;

-- ── Absences ─────────────────────────────────────────────────────────────
-- Refuse tout chevauchement avec une autre absence de la même personne
-- (pas de double déduction ; modifier l'absence existante à la place).
-- Demi-journées : matin et après-midi d'un même jour peuvent coexister.
create or replace function public.team_save_absence(
  p_id uuid, p_member uuid, p_kind text, p_start date, p_end date, p_portion text, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare
  v_id uuid := p_id;
  v_conflict public.team_absences%rowtype;
begin
  perform public.team_require_member(p_member, false);
  if p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  if p_portion <> 'full' and p_start <> p_end then raise exception 'Une demi-journée porte sur un seul jour' using errcode = 'P0001'; end if;
  if p_kind not in ('vacation', 'sick', 'accident', 'other', 'employer_reduction') then raise exception 'Type d''absence inconnu' using errcode = 'P0001'; end if;
  select * into v_conflict from public.team_absences a
  where a.member_id = p_member and a.deleted_at is null and a.id is distinct from p_id
    and a.start_date <= p_end and p_start <= a.end_date
    and not (a.portion <> 'full' and p_portion <> 'full' and a.portion <> p_portion)
  order by a.start_date limit 1;
  if found then
    raise exception 'Chevauche une absence déjà enregistrée du % au % (%)', to_char(v_conflict.start_date, 'DD.MM.YYYY'),
      to_char(v_conflict.end_date, 'DD.MM.YYYY'), v_conflict.id using errcode = 'P0005';
  end if;
  if v_id is null then
    insert into public.team_absences (member_id, kind, start_date, end_date, portion, note, created_by, updated_by)
    values (p_member, p_kind, p_start, p_end, p_portion, nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  else
    update public.team_absences
       set kind = p_kind, start_date = p_start, end_date = p_end, portion = p_portion, note = nullif(btrim(p_note), ''),
           updated_by = p_by, updated_at = now()
     where id = v_id and member_id = p_member and deleted_at is null;
    if not found then raise exception 'Absence introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- ── Marque « jour non travaillé » ────────────────────────────────────────
create or replace function public.team_save_mark(p_member uuid, p_date date, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  perform public.team_require_member(p_member, true);
  if exists (select 1 from public.team_work_logs where member_id = p_member and work_date = p_date and deleted_at is null) then
    raise exception 'Des heures sont saisies ce jour-là' using errcode = 'P0001';
  end if;
  select id into v_id from public.team_day_marks where member_id = p_member and mark_date = p_date and deleted_at is null;
  if found then return v_id; end if;
  insert into public.team_day_marks (member_id, mark_date, note, created_by, updated_by)
  values (p_member, p_date, nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  return v_id;
end;
$$;

-- ── Contrats ─────────────────────────────────────────────────────────────
-- Modifier une période ou en créer une nouvelle (prolongation) ; deux
-- périodes d'une même personne ne peuvent pas se chevaucher. Rien n'est
-- écrasé : chaque modification est conservée dans team_audit.
create or replace function public.team_save_contract(
  p_id uuid, p_member uuid, p_label text, p_start date, p_end date, p_rate numeric,
  p_weekly int, p_entitlement int, p_day int, p_half int, p_week int, p_reference jsonb,
  p_sat_replace boolean, p_holiday_reduces boolean, p_credit_basis text, p_notes text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id; v_sum int; k text;
begin
  perform public.team_require_member(p_member, true);
  if p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  if p_credit_basis not in ('reference', 'planned', 'leave_day') then raise exception 'Réglage de crédit inconnu' using errcode = 'P0001'; end if;
  foreach k in array array['1', '2', '3', '4', '5', '6', '7'] loop
    if not (p_reference ? k) or (p_reference ->> k)::int < 0 then
      raise exception 'Répartition de référence incomplète (jour %)', k using errcode = 'P0001';
    end if;
  end loop;
  select sum((p_reference ->> d.n)::int) into v_sum from unnest(array['1', '2', '3', '4', '5', '6', '7']) as d(n);
  if v_sum <> p_weekly then
    raise exception 'La répartition de référence (% min) doit égaler l''objectif hebdomadaire (% min)', v_sum, p_weekly using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_contracts c where c.member_id = p_member and c.deleted_at is null
             and c.id is distinct from p_id and c.start_date <= p_end and p_start <= c.end_date) then
    raise exception 'Cette période chevauche une autre période de contrat' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.team_contracts (member_id, label, start_date, end_date, rate_pct, weekly_target_min, leave_entitlement_min,
      leave_day_min, leave_half_day_min, leave_week_min, reference_schedule, saturday_can_replace, holiday_reduces_target,
      absence_credit_basis, notes, created_by, updated_by)
    values (p_member, nullif(btrim(p_label), ''), p_start, p_end, p_rate, p_weekly, p_entitlement, p_day, p_half, p_week, p_reference,
      p_sat_replace, p_holiday_reduces, p_credit_basis, nullif(btrim(p_notes), ''), p_by, p_by) returning id into v_id;
  else
    update public.team_contracts
       set label = nullif(btrim(p_label), ''), start_date = p_start, end_date = p_end, rate_pct = p_rate, weekly_target_min = p_weekly,
           leave_entitlement_min = p_entitlement, leave_day_min = p_day, leave_half_day_min = p_half, leave_week_min = p_week,
           reference_schedule = p_reference, saturday_can_replace = p_sat_replace, holiday_reduces_target = p_holiday_reduces,
           absence_credit_basis = p_credit_basis, notes = nullif(btrim(p_notes), ''), updated_by = p_by, updated_at = now()
     where id = v_id and member_id = p_member and deleted_at is null;
    if not found then raise exception 'Contrat introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.team_save_holiday(p_date date, p_label text, p_delete boolean, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if p_delete then
    update public.team_holidays set deleted_at = now(), deleted_by = p_by where holiday_date = p_date and deleted_at is null;
  else
    insert into public.team_holidays (holiday_date, label, created_by) values (p_date, btrim(p_label), p_by)
    on conflict (holiday_date) do update set label = excluded.label, deleted_at = null, deleted_by = null;
  end if;
end;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['team_members', 'team_contracts', 'team_schedule_slots', 'team_work_logs', 'team_absences', 'team_day_marks', 'team_holidays', 'team_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'trg_team_audit()', 'team_member_id(text)', 'team_contract_on(uuid, date)', 'team_require_member(uuid, boolean)',
    'team_planning_data(date, date)', 'team_history(text, text)',
    'team_save_slot(uuid, uuid, date, time, time, int, text, text)', 'team_delete_row(text, uuid, text)',
    'team_copy_week(uuid, date, date, boolean, text)', 'team_save_log(uuid, uuid, date, time, time, int, text, text, date)',
    'team_realize_as_planned(uuid, date, text, date)',
    'team_save_absence(uuid, uuid, text, date, date, text, text, text)', 'team_save_mark(uuid, date, text, text)',
    'team_save_contract(uuid, uuid, text, date, date, numeric, int, int, int, int, int, jsonb, boolean, boolean, text, text, text)',
    'team_save_holiday(date, text, boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

-- ── Données initiales ────────────────────────────────────────────────────
insert into public.team_members (slug, display_name, color, tracks_hours, tracks_leave) values
  ('nahya', 'Nahya', '#C2185B', true, true),
  ('elie', 'Élie', '#1565C0', false, false),
  ('melodie', 'Melodie', '#2E7D32', false, false)
on conflict (slug) do nothing;

-- Contrat de Nahya (valeurs relevées par les propriétaires, 01.10.2026).
-- Horaire indicatif : lun, mar, mer, ven 9h–13h (240 min) ; jeu 9h–14h
-- (300 min) = 1 260 min. Valeurs déjà au prorata du temps partiel.
insert into public.team_contracts (member_id, label, start_date, end_date, rate_pct, weekly_target_min, leave_entitlement_min,
  leave_day_min, leave_half_day_min, leave_week_min, reference_schedule, saturday_can_replace, created_by, updated_by)
select public.team_member_id('nahya'), 'Contrat initial', date '2026-09-29', date '2026-12-27', 50, 1260, 1575, 252, 126, 1260,
       '{"1":240,"2":240,"3":240,"4":300,"5":240,"6":0,"7":0}'::jsonb, true, 'migration', 'migration'
where not exists (select 1 from public.team_contracts where member_id = public.team_member_id('nahya') and deleted_at is null);

-- Jours fériés du canton de Genève (2026–2027). Liste modifiable dans l'admin ;
-- leur traitement exact est à confirmer avec le fiduciaire.
insert into public.team_holidays (holiday_date, label, created_by) values
  ('2026-01-01', 'Nouvel An', 'migration'), ('2026-04-03', 'Vendredi saint', 'migration'), ('2026-04-06', 'Lundi de Pâques', 'migration'),
  ('2026-05-14', 'Ascension', 'migration'), ('2026-05-25', 'Lundi de Pentecôte', 'migration'), ('2026-08-01', 'Fête nationale', 'migration'),
  ('2026-09-10', 'Jeûne genevois', 'migration'), ('2026-12-25', 'Noël', 'migration'), ('2026-12-31', 'Restauration de la République', 'migration'),
  ('2027-01-01', 'Nouvel An', 'migration'), ('2027-03-26', 'Vendredi saint', 'migration'), ('2027-03-29', 'Lundi de Pâques', 'migration'),
  ('2027-05-06', 'Ascension', 'migration'), ('2027-05-17', 'Lundi de Pentecôte', 'migration'), ('2027-08-01', 'Fête nationale', 'migration'),
  ('2027-09-09', 'Jeûne genevois', 'migration'), ('2027-12-25', 'Noël', 'migration'), ('2027-12-31', 'Restauration de la République', 'migration')
on conflict (holiday_date) do nothing;

commit;
