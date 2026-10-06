-- F23 — Accès employée (Nahya), séparé des accès administrateurs.
--
-- À appliquer après F22. Ne rejoue aucune migration, ne modifie aucune
-- commande ni aucune donnée existante. Additive, relançable.
--
-- 1. staff_permissions : catalogue des droits possibles. « available =
--    false » = prévu mais pas encore activable (brouillons de commandes
--    manuelles sans prix) : aucun accès ne peut le recevoir tant qu'il n'est
--    pas activé par une migration.
-- 2. staff_access : un accès employée = un email (le compte Supabase Auth de
--    la personne), une personne de l'équipe (team_members), des droits.
--    Mel et Eli restent administratrices par la liste existante (code des
--    fonctions) : rien ne change pour elles ; une adresse administratrice ne
--    peut pas recevoir d'accès employée.
-- 3. team_leave_requests : demandes de congés. L'employée demande, Mel ou
--    Eli approuve ou refuse ; une demande approuvée crée l'absence
--    « vacances » par la fonction existante (team_save_absence, mêmes règles
--    de chevauchement) : le solde est calculé avec les règles existantes.
-- Tout est réservé à service_role (lu par les fonctions, qui vérifient qui
-- appelle) ; historique dans team_audit.

begin;

-- ── 1. Catalogue des droits ──────────────────────────────────────────────
create table if not exists public.staff_permissions (
  code        text primary key,
  label       text not null,
  available   boolean not null default true,
  sort        integer not null default 0
);
insert into public.staff_permissions (code, label, available, sort) values
  ('today.view',          'Aujourd''hui : gâteaux et workshops à préparer (sans montants)', true, 10),
  ('production.view',     'Production : liste à préparer (sans montants)', true, 20),
  ('production.update',   'Production : cocher « À préparer / Fait »', true, 30),
  ('orders.view',         'Commandes : consultation en lecture seule (sans montants)', true, 40),
  ('planning.view',       'Planning des commandes par date (sans montants)', true, 50),
  ('team.self',           'Mon planning : mes horaires', true, 60),
  ('leave.self',          'Mes congés : demandes et solde personnel', true, 70),
  ('manual_orders.draft', 'Brouillons de commandes manuelles sans prix (pas encore disponible)', false, 80)
on conflict (code) do update set label = excluded.label, sort = excluded.sort;
-- « available » n'est jamais remis à true par une relance : seule une migration dédiée l'activera.

-- ── 2. Accès employée ────────────────────────────────────────────────────
create table if not exists public.staff_access (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null unique references public.team_members(id),
  email         text check (email is null or email = lower(btrim(email))),
  user_id       uuid,
  role          text not null default 'employee' check (role = 'employee'),
  permissions   text[] not null default '{}',
  active        boolean not null default false,
  invited_at    timestamptz,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create unique index if not exists staff_access_email_uidx on public.staff_access (email) where email is not null and deleted_at is null;

-- Droits : seulement des codes connus et disponibles ; jamais une adresse administratrice.
create or replace function public.trg_staff_access_check()
returns trigger language plpgsql set search_path to '' as $$
declare v_bad text;
begin
  select string_agg(p, ', ') into v_bad from unnest(new.permissions) p
  where not exists (select 1 from public.staff_permissions s where s.code = p and s.available);
  if v_bad is not null then raise exception 'Droit inconnu ou pas encore disponible : %', v_bad using errcode = 'P0001'; end if;
  if new.email in ('naglemelodie@gmail.com', 'e.potapushina@gmail.com') then
    raise exception 'Cette adresse est administratrice : pas d''accès employée' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_staff_access_check on public.staff_access;
create trigger trg_staff_access_check before insert or update on public.staff_access for each row execute function public.trg_staff_access_check();

-- Accès d'un compte connecté (email + identifiant Auth). L'identifiant est
-- fixé à la première connexion puis doit toujours correspondre : un autre
-- compte qui prendrait la même adresse n'hérite d'aucun droit.
create or replace function public.staff_lookup(p_email text, p_user uuid)
returns jsonb language plpgsql set search_path to '' as $$
declare v public.staff_access%rowtype;
begin
  select * into v from public.staff_access
  where email = lower(btrim(p_email)) and active and deleted_at is null;
  if not found then return null; end if;
  if v.user_id is null then
    update public.staff_access set user_id = p_user, updated_by = 'connexion' where id = v.id returning * into v;
  elsif v.user_id <> p_user then
    return null;
  end if;
  return jsonb_build_object('accessId', v.id, 'memberId', v.member_id, 'email', v.email, 'role', v.role,
    'permissions', to_jsonb(v.permissions),
    'memberName', (select display_name from public.team_members where id = v.member_id));
end;
$$;

-- Préparer / mettre à jour l'accès d'une personne (admin). L'invitation
-- (e-mail Supabase Auth) est envoyée par la fonction staff-access.
create or replace function public.staff_access_save(p_member uuid, p_email text, p_permissions text[], p_active boolean, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v public.staff_access%rowtype; v_email text := nullif(lower(btrim(p_email)), '');
begin
  perform public.team_require_member(p_member, false);
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse email invalide' using errcode = 'P0001'; end if;
  select * into v from public.staff_access where member_id = p_member for update;
  if found then
    update public.staff_access
       set email = v_email,
           user_id = case when v_email is distinct from v.email then null else v.user_id end,
           permissions = coalesce(p_permissions, v.permissions), active = coalesce(p_active, v.active),
           updated_by = p_by, deleted_at = null, deleted_by = null
     where id = v.id returning * into v;
  else
    insert into public.staff_access (member_id, email, permissions, active, created_by, updated_by)
    values (p_member, v_email, coalesce(p_permissions, '{}'), coalesce(p_active, false), p_by, p_by) returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function public.staff_access_mark_invited(p_member uuid, p_by text)
returns void language sql set search_path to '' as $$
  update public.staff_access set invited_at = now(), updated_by = p_by where member_id = p_member;
$$;

create or replace function public.staff_access_list()
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'access', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('memberName', m.display_name) order by m.display_name)
                        from public.staff_access a join public.team_members m on m.id = a.member_id where a.deleted_at is null), '[]'::jsonb),
    'permissions', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort) from public.staff_permissions p), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'slug', m.slug, 'name', m.display_name) order by m.created_at)
                         from public.team_members m where m.active), '[]'::jsonb));
$$;

-- ── 3. Demandes de congés ────────────────────────────────────────────────
create table if not exists public.team_leave_requests (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.team_members(id),
  start_date    date not null,
  end_date      date not null,
  portion       text not null default 'full' check (portion in ('full', 'am', 'pm')),
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'cancelled')),
  absence_id    uuid references public.team_absences(id),
  decision_note text,
  decided_by    text,
  decided_at    timestamptz,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint team_leave_requests_dates_check check (end_date >= start_date),
  constraint team_leave_requests_half_check check (portion = 'full' or start_date = end_date)
);
create index if not exists team_leave_requests_member_idx on public.team_leave_requests (member_id, start_date);

do $$
declare t text;
begin
  foreach t in array array['staff_access', 'team_leave_requests'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_team_audit()', t);
  end loop;
end $$;

-- Nouvelle demande : pas de chevauchement avec une absence enregistrée ni
-- avec une autre demande en attente de la même personne.
create or replace function public.leave_request_create(p_member uuid, p_start date, p_end date, p_portion text, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v public.team_leave_requests%rowtype; v_a public.team_absences%rowtype;
begin
  perform public.team_require_member(p_member, false);
  if p_start is null or p_end is null or p_end < p_start then raise exception 'La date de fin doit être après la date de début' using errcode = 'P0001'; end if;
  if coalesce(p_portion, 'full') not in ('full', 'am', 'pm') then raise exception 'Durée invalide' using errcode = 'P0001'; end if;
  if p_portion <> 'full' and p_start <> p_end then raise exception 'Une demi-journée porte sur un seul jour' using errcode = 'P0001'; end if;
  if p_end - p_start > 62 then raise exception 'Demande trop longue (63 jours au plus)' using errcode = 'P0001'; end if;
  select * into v_a from public.team_absences a
  where a.member_id = p_member and a.deleted_at is null and a.start_date <= p_end and p_start <= a.end_date
    and not (a.portion <> 'full' and p_portion <> 'full' and a.portion <> p_portion) limit 1;
  if found then
    raise exception 'Chevauche une absence déjà enregistrée du % au %', to_char(v_a.start_date, 'DD.MM.YYYY'), to_char(v_a.end_date, 'DD.MM.YYYY') using errcode = 'P0001';
  end if;
  select * into v from public.team_leave_requests r
  where r.member_id = p_member and r.status = 'pending' and r.deleted_at is null and r.start_date <= p_end and p_start <= r.end_date
    and not (r.portion <> 'full' and p_portion <> 'full' and r.portion <> p_portion) limit 1;
  if found then
    raise exception 'Une demande en attente couvre déjà le % au %', to_char(v.start_date, 'DD.MM.YYYY'), to_char(v.end_date, 'DD.MM.YYYY') using errcode = 'P0001';
  end if;
  insert into public.team_leave_requests (member_id, start_date, end_date, portion, note, created_by, updated_by)
  values (p_member, p_start, p_end, coalesce(p_portion, 'full'), nullif(btrim(p_note), ''), p_by, p_by) returning * into v;
  return to_jsonb(v);
end;
$$;

-- Annuler sa propre demande (seulement en attente).
create or replace function public.leave_request_cancel(p_id uuid, p_member uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.team_leave_requests set status = 'cancelled', updated_by = p_by, updated_at = now()
   where id = p_id and member_id = p_member and status = 'pending';
  if not found then raise exception 'Demande introuvable ou déjà traitée' using errcode = 'P0002'; end if;
end;
$$;

-- Décision (admin). Approuver crée l'absence « vacances » (mêmes règles que
-- la saisie dans l'admin) ; une demande déjà traitée ne change plus.
create or replace function public.leave_request_decide(p_id uuid, p_approve boolean, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v public.team_leave_requests%rowtype; v_abs uuid;
begin
  select * into v from public.team_leave_requests where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Demande introuvable' using errcode = 'P0002'; end if;
  if v.status <> 'pending' then raise exception 'Cette demande est déjà traitée (%)', v.status using errcode = 'P0001'; end if;
  if p_approve then
    v_abs := public.team_save_absence(null, v.member_id, 'vacation', v.start_date, v.end_date, v.portion,
      coalesce(nullif(btrim(v.note), ''), 'Demande de congé') , p_by);
    update public.team_leave_requests set status = 'approved', absence_id = v_abs, decision_note = nullif(btrim(p_note), ''),
           decided_by = p_by, decided_at = now(), updated_by = p_by, updated_at = now()
     where id = p_id returning * into v;
  else
    update public.team_leave_requests set status = 'refused', decision_note = nullif(btrim(p_note), ''),
           decided_by = p_by, decided_at = now(), updated_by = p_by, updated_at = now()
     where id = p_id returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function public.leave_requests_list(p_member uuid)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('memberName', m.display_name) order by r.status <> 'pending', r.start_date desc), '[]'::jsonb)
  from public.team_leave_requests r join public.team_members m on m.id = r.member_id
  where r.deleted_at is null and (p_member is null or r.member_id = p_member);
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['staff_permissions', 'staff_access', 'team_leave_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'trg_staff_access_check()', 'staff_lookup(text, uuid)', 'staff_access_save(uuid, text, text[], boolean, text)',
    'staff_access_mark_invited(uuid, text)', 'staff_access_list()',
    'leave_request_create(uuid, date, date, text, text, text)', 'leave_request_cancel(uuid, uuid, text)',
    'leave_request_decide(uuid, boolean, text, text)', 'leave_requests_list(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

commit;
