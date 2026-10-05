-- F27 — Événements de l'équipe (Admin > Équipe), 06.10.2026.
--
-- Pour l'organisation interne uniquement : cuisine indisponible, rendez-vous,
-- livraison fournisseur, salon… Un événement NE TOUCHE NI au site, ni aux
-- commandes, ni aux paiements (les commandes restent acceptées).
-- Mel et Eli créent / modifient / suppriment (suppression logique, historique
-- dans team_audit comme le reste de l'équipe). L'employée ne voit que les
-- événements cochés « visible par l'employée » (visible_to_staff), en lecture.
-- Accès : service_role uniquement (fonction team-planning).
-- Relançable sans effet de bord.

create table if not exists public.team_events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 120),
  kind             text not null default 'other'
                     check (kind in ('kitchen_unavailable', 'appointment', 'supplier_delivery', 'event', 'other')),
  start_date       date not null,
  end_date         date not null,
  start_time       time,
  end_time         time,
  note             text,
  visible_to_staff boolean not null default false,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       text,
  constraint team_events_dates_check check (end_date >= start_date),
  -- Journée entière (sans heures) ou heures de début ET de fin, sur un seul jour.
  constraint team_events_times_check check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and end_time > start_time and start_date = end_date))
);
create index if not exists team_events_dates_idx on public.team_events (start_date, end_date) where deleted_at is null;

drop trigger if exists trg_team_events_audit on public.team_events;
create trigger trg_team_events_audit after insert or update or delete on public.team_events
  for each row execute function public.trg_team_audit();

-- Enregistrer (créer si p_id est null, sinon modifier).
create or replace function public.team_save_event(
  p_id uuid, p_title text, p_kind text, p_start date, p_end date, p_start_time time, p_end_time time,
  p_note text, p_visible boolean, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'Titre manquant' using errcode = 'P0001'; end if;
  if char_length(btrim(p_title)) > 120 then raise exception 'Titre trop long (120 caractères maximum)' using errcode = 'P0001'; end if;
  if p_kind not in ('kitchen_unavailable', 'appointment', 'supplier_delivery', 'event', 'other') then
    raise exception 'Type d''événement inconnu' using errcode = 'P0001';
  end if;
  if p_start is null or p_end is null then raise exception 'Dates manquantes' using errcode = 'P0001'; end if;
  if p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  if (p_start_time is null) <> (p_end_time is null) then raise exception 'Indiquez l''heure de début et l''heure de fin' using errcode = 'P0001'; end if;
  if p_start_time is not null then
    if p_end_time <= p_start_time then raise exception 'L''heure de fin doit être après l''heure de début' using errcode = 'P0001'; end if;
    if p_end <> p_start then raise exception 'Des heures ne sont possibles que sur un seul jour' using errcode = 'P0001'; end if;
  end if;
  if v_id is null then
    insert into public.team_events (title, kind, start_date, end_date, start_time, end_time, note, visible_to_staff, created_by, updated_by)
    values (btrim(p_title), p_kind, p_start, p_end, p_start_time, p_end_time, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_visible, false), p_by, p_by)
    returning id into v_id;
  else
    update public.team_events
       set title = btrim(p_title), kind = p_kind, start_date = p_start, end_date = p_end, start_time = p_start_time, end_time = p_end_time,
           note = nullif(btrim(coalesce(p_note, '')), ''), visible_to_staff = coalesce(p_visible, false), updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null;
    if not found then raise exception 'Événement introuvable ou supprimé' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- Suppression logique (gardée dans l'historique).
create or replace function public.team_delete_event(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.team_events set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Événement introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

-- Événements qui touchent la période. p_staff_only : seulement ceux visibles par l'employée.
create or replace function public.team_events_between(p_from date, p_to date, p_staff_only boolean)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'kind', kind, 'start_date', start_date, 'end_date', end_date,
           'start_time', to_char(start_time, 'HH24:MI'), 'end_time', to_char(end_time, 'HH24:MI'),
           'note', note, 'visible_to_staff', visible_to_staff)
         order by start_date, start_time nulls first, title), '[]'::jsonb)
  from public.team_events
  where deleted_at is null and start_date <= p_to and end_date >= p_from
    and (not p_staff_only or visible_to_staff);
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
alter table public.team_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'team_events' and policyname = 'Service role only') then
    create policy "Service role only" on public.team_events for all using (false) with check (false);
  end if;
end $$;
revoke all on public.team_events from anon, authenticated;
revoke all on function public.team_save_event(uuid, text, text, date, date, time, time, text, boolean, text) from public, anon, authenticated;
revoke all on function public.team_delete_event(uuid, text) from public, anon, authenticated;
revoke all on function public.team_events_between(date, date, boolean) from public, anon, authenticated;
grant execute on function public.team_save_event(uuid, text, text, date, date, time, time, text, boolean, text) to service_role;
grant execute on function public.team_delete_event(uuid, text) to service_role;
grant execute on function public.team_events_between(date, date, boolean) to service_role;
