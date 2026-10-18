-- F32 — Événements du Planning (fêtes et marketing), 16.10.2026.
--
-- Admin > Planning : les occasions de l'année (Noël, Fête des Mères…) avec
-- leurs idées (gâteaux, collections, visuels) et une liste de tâches datées
-- (« Fait » coché ou non) pour préparer produits, photos, communication et
-- vitrine. Pour l'organisation uniquement : un événement NE TOUCHE NI au
-- site, ni aux commandes, ni aux paiements.
-- Mel et Eli seulement (fonction marketing-events) ; l'employée ne les voit
-- pas. Suppressions logiques, historique dans team_audit (même déclencheur
-- que l'Équipe).
-- Préparer l'année suivante : copie des événements d'une année (dates +1 an,
-- marqués « dates à vérifier », idées et note copiées, tâches décalées et
-- décochées), sans jamais copier deux fois le même événement.
-- Accès : service_role uniquement. Relançable sans effet de bord.

create table if not exists public.marketing_events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  start_date      date not null,
  end_date        date not null,
  indicative      boolean not null default false,
  note            text check (note is null or char_length(note) <= 500),
  ideas           text check (ideas is null or char_length(ideas) <= 10000),
  dates_to_check  boolean not null default false,
  source_event_id uuid references public.marketing_events (id),
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      text,
  constraint marketing_events_dates_check check (end_date >= start_date)
);
create index if not exists marketing_events_dates_idx on public.marketing_events (start_date, end_date) where deleted_at is null;

create table if not exists public.marketing_event_tasks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.marketing_events (id),
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  due_date    date,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     text,
  created_by  text,
  updated_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  text
);
create index if not exists marketing_event_tasks_event_idx on public.marketing_event_tasks (event_id) where deleted_at is null;
create index if not exists marketing_event_tasks_due_idx on public.marketing_event_tasks (due_date) where deleted_at is null;

drop trigger if exists trg_marketing_events_audit on public.marketing_events;
create trigger trg_marketing_events_audit after insert or update or delete on public.marketing_events
  for each row execute function public.trg_team_audit();
drop trigger if exists trg_marketing_event_tasks_audit on public.marketing_event_tasks;
create trigger trg_marketing_event_tasks_audit after insert or update or delete on public.marketing_event_tasks
  for each row execute function public.trg_team_audit();

-- ── Lecture ──────────────────────────────────────────────────────────────
create or replace function public.mkt_task_json(t public.marketing_event_tasks)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('id', t.id, 'event_id', t.event_id, 'title', t.title, 'due_date', t.due_date, 'done', t.done);
$$;

create or replace function public.mkt_event_json(p_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_date', e.start_date, 'end_date', e.end_date, 'indicative', e.indicative,
           'note', e.note, 'ideas', e.ideas, 'dates_to_check', e.dates_to_check,
           'tasks', coalesce((select jsonb_agg(public.mkt_task_json(t) order by t.due_date nulls last, t.created_at)
                                from public.marketing_event_tasks t where t.event_id = e.id and t.deleted_at is null), '[]'::jsonb))
  from public.marketing_events e where e.id = p_id and e.deleted_at is null;
$$;

-- Planning d'une période : événements qui la touchent (avec leurs tâches),
-- tâches datées dans la période (avec le nom de l'événement), et « À
-- préparer » : tâches non faites prévues jusqu'à p_today + 13 jours (retards
-- compris), quel que soit le mois affiché.
create or replace function public.mkt_planning(p_from date, p_to date, p_today date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'events', coalesce((select jsonb_agg(public.mkt_event_json(e.id) order by e.start_date, e.end_date, e.title)
                          from public.marketing_events e
                         where e.deleted_at is null and e.start_date <= p_to and e.end_date >= p_from), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(public.mkt_task_json(t) || jsonb_build_object('event_title', e.title) order by t.due_date, e.title, t.created_at)
                         from public.marketing_event_tasks t join public.marketing_events e on e.id = t.event_id
                        where t.deleted_at is null and e.deleted_at is null and t.due_date between p_from and p_to), '[]'::jsonb),
    'todo', coalesce((select jsonb_agg(public.mkt_task_json(t) || jsonb_build_object('event_title', e.title) order by t.due_date, e.title, t.created_at)
                        from public.marketing_event_tasks t join public.marketing_events e on e.id = t.event_id
                       where t.deleted_at is null and e.deleted_at is null and not t.done and t.due_date <= p_today + 13), '[]'::jsonb));
$$;

-- ── Événements ───────────────────────────────────────────────────────────
create or replace function public.mkt_save_event(
  p_id uuid, p_title text, p_start date, p_end date, p_indicative boolean, p_note text, p_ideas text,
  p_dates_to_check boolean, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Nom manquant' using errcode = 'P0001'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'Nom trop long (120 caractères maximum)' using errcode = 'P0001'; end if;
  if p_start is null or p_end is null then raise exception 'Dates manquantes' using errcode = 'P0001'; end if;
  if p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_note, '')) > 500 then raise exception 'Note trop longue (500 caractères maximum)' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_ideas, '')) > 10000 then raise exception 'Idées trop longues (10 000 caractères maximum)' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.marketing_events (title, start_date, end_date, indicative, note, ideas, dates_to_check, created_by, updated_by)
    values (btrim(p_title), p_start, p_end, coalesce(p_indicative, false), nullif(btrim(coalesce(p_note, '')), ''),
            nullif(btrim(coalesce(p_ideas, '')), ''), coalesce(p_dates_to_check, false), p_by, p_by)
    returning id into v_id;
  else
    update public.marketing_events
       set title = btrim(p_title), start_date = p_start, end_date = p_end, indicative = coalesce(p_indicative, false),
           note = nullif(btrim(coalesce(p_note, '')), ''), ideas = nullif(btrim(coalesce(p_ideas, '')), ''),
           dates_to_check = coalesce(p_dates_to_check, false), updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null;
    if not found then raise exception 'Événement introuvable ou supprimé' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- Suppression logique de l'événement et de ses tâches (historique gardé).
create or replace function public.mkt_delete_event(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.marketing_events set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Événement introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
  update public.marketing_event_tasks set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where event_id = p_id and deleted_at is null;
end;
$$;

-- Copie interne : nouvel événement (idées et note comprises) + tâches
-- décalées de p_shift (décochées).
create or replace function public.mkt_copy_event(p_id uuid, p_start date, p_end date, p_shift interval, p_to_check boolean, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  insert into public.marketing_events (title, start_date, end_date, indicative, note, ideas, dates_to_check, source_event_id, created_by, updated_by)
  select title, p_start, p_end, indicative, note, ideas, p_to_check, id, p_by, p_by
    from public.marketing_events where id = p_id and deleted_at is null
  returning id into v_id;
  if v_id is null then raise exception 'Événement introuvable ou supprimé' using errcode = 'P0002'; end if;
  insert into public.marketing_event_tasks (event_id, title, due_date, created_by, updated_by)
  select v_id, title, (due_date + p_shift)::date, p_by, p_by
    from public.marketing_event_tasks where event_id = p_id and deleted_at is null
   order by due_date nulls last, created_at;
  return v_id;
end;
$$;

-- Dupliquer un événement à de nouvelles dates choisies (tâches décalées
-- d'autant de jours que le début).
create or replace function public.mkt_duplicate_event(p_id uuid, p_start date, p_end date, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_old date;
begin
  if p_start is null or p_end is null then raise exception 'Dates manquantes' using errcode = 'P0001'; end if;
  if p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  select start_date into v_old from public.marketing_events where id = p_id and deleted_at is null;
  if v_old is null then raise exception 'Événement introuvable ou supprimé' using errcode = 'P0002'; end if;
  return public.mkt_copy_event(p_id, p_start, p_end, make_interval(days => p_start - v_old), false, p_by);
end;
$$;

-- Préparer une autre année : chaque événement commençant en p_from_year est
-- copié une fois en p_to_year, mêmes jour et mois (29 février → 28),
-- « dates à vérifier ». Un événement déjà copié vers cette année est ignoré.
create or replace function public.mkt_duplicate_year(p_from_year int, p_to_year int, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_shift interval;
  e record;
  v_created int := 0;
  v_skipped int := 0;
begin
  if p_from_year is null or p_to_year is null or p_from_year not between 2000 and 2100 or p_to_year not between 2000 and 2100 then
    raise exception 'Année invalide' using errcode = 'P0001';
  end if;
  if p_to_year = p_from_year then raise exception 'Choisissez une autre année' using errcode = 'P0001'; end if;
  v_shift := make_interval(years => p_to_year - p_from_year);
  for e in
    select id, start_date, end_date from public.marketing_events
     where deleted_at is null and extract(year from start_date) = p_from_year
     order by start_date, title
  loop
    if exists (select 1 from public.marketing_events c
                where c.source_event_id = e.id and c.deleted_at is null and extract(year from c.start_date) = p_to_year) then
      v_skipped := v_skipped + 1;
    else
      perform public.mkt_copy_event(e.id, (e.start_date + v_shift)::date, (e.end_date + v_shift)::date, v_shift, true, p_by);
      v_created := v_created + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

-- ── Tâches ───────────────────────────────────────────────────────────────
create or replace function public.mkt_save_task(p_id uuid, p_event uuid, p_title text, p_due date, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Tâche vide' using errcode = 'P0001'; end if;
  if char_length(btrim(p_title)) > 200 then raise exception 'Tâche trop longue (200 caractères maximum)' using errcode = 'P0001'; end if;
  if v_id is null then
    if not exists (select 1 from public.marketing_events where id = p_event and deleted_at is null) then
      raise exception 'Événement introuvable ou supprimé' using errcode = 'P0002';
    end if;
    insert into public.marketing_event_tasks (event_id, title, due_date, created_by, updated_by)
    values (p_event, btrim(p_title), p_due, p_by, p_by) returning id into v_id;
  else
    update public.marketing_event_tasks
       set title = btrim(p_title), due_date = p_due, updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null;
    if not found then raise exception 'Tâche introuvable ou supprimée' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.mkt_set_task_done(p_id uuid, p_done boolean, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.marketing_event_tasks
     set done = coalesce(p_done, false),
         done_at = case when coalesce(p_done, false) then coalesce(done_at, now()) end,
         done_by = case when coalesce(p_done, false) then coalesce(done_by, p_by) end,
         updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Tâche introuvable ou supprimée' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.mkt_delete_task(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.marketing_event_tasks set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Tâche introuvable ou déjà supprimée' using errcode = 'P0002'; end if;
end;
$$;

-- ── Événements 2026 (une seule fois, même après suppression) ─────────────
insert into public.marketing_events (title, start_date, end_date, indicative, note, created_by, updated_by)
select v.title, v.s::date, v.e::date, v.ind, v.note, 'F32', 'F32'
from (values
  ('Nouvel An',                                       '2026-01-01', '2026-01-01', false, null),
  ('Saint-Valentin',                                  '2026-02-14', '2026-02-14', false, null),
  ('Fête des grands-mères (France)',                  '2026-03-01', '2026-03-01', false, null),
  ('Journée internationale des droits des femmes',    '2026-03-08', '2026-03-08', false, null),
  ('Pâques',                                          '2026-04-05', '2026-04-06', false, null),
  ('Watches & Wonders Geneva',                        '2026-04-14', '2026-04-20', false, 'Public : 18–20 avril'),
  ('Fête des Mères (Suisse)',                         '2026-05-10', '2026-05-10', false, null),
  ('Fête des Mères (France)',                         '2026-05-31', '2026-05-31', false, null),
  ('Remises de diplômes',                             '2026-05-25', '2026-06-30', true,  null),
  ('Fête des Pères (Suisse)',                         '2026-06-07', '2026-06-07', false, null),
  ('Fête des Pères (France)',                         '2026-06-21', '2026-06-21', false, null),
  ('Fête nationale suisse',                           '2026-08-01', '2026-08-01', false, null),
  ('Fête des grands-pères (France)',                  '2026-10-04', '2026-10-04', false, null),
  ('Halloween',                                       '2026-10-31', '2026-10-31', false, null),
  ('Repas et fêtes de fin d''année des entreprises',  '2026-11-01', '2026-12-31', true,  null),
  ('Escalade',                                        '2026-12-12', '2026-12-12', false, 'Festivités du 11 au 13 décembre'),
  ('Noël',                                            '2026-12-24', '2026-12-25', false, null)
) as v(title, s, e, ind, note)
where not exists (select 1 from public.marketing_events m where m.title = v.title and extract(year from m.start_date) = 2026);

-- ── Accès : service_role uniquement ──────────────────────────────────────
alter table public.marketing_events enable row level security;
alter table public.marketing_event_tasks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_events' and policyname = 'Service role only') then
    create policy "Service role only" on public.marketing_events for all using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'marketing_event_tasks' and policyname = 'Service role only') then
    create policy "Service role only" on public.marketing_event_tasks for all using (false) with check (false);
  end if;
end $$;
revoke all on public.marketing_events from anon, authenticated;
revoke all on public.marketing_event_tasks from anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.mkt_task_json(public.marketing_event_tasks)', 'public.mkt_event_json(uuid)', 'public.mkt_planning(date, date, date)',
    'public.mkt_save_event(uuid, text, date, date, boolean, text, text, boolean, text)', 'public.mkt_delete_event(uuid, text)',
    'public.mkt_copy_event(uuid, date, date, interval, boolean, text)', 'public.mkt_duplicate_event(uuid, date, date, text)',
    'public.mkt_duplicate_year(int, int, text)', 'public.mkt_save_task(uuid, uuid, text, date, text)',
    'public.mkt_set_task_done(uuid, boolean, text)', 'public.mkt_delete_task(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
