-- F21 — Admin > Clients : action unique « Modifier l'adresse email ».
-- À appliquer après F20. Ne rejoue aucune migration, ne modifie aucune
-- donnée existante. Additive, relançable.
--
-- Une modification = une opération (customer_email_changes) avec ses étapes :
--   auth    — email de connexion (Supabase Auth), si la fiche a un compte ;
--   db      — email du profil (compte) ET email de contact de la fiche, dans
--             UNE transaction (customer_email_change_apply_db) ;
--   brevo   — contact Brevo existant renommé (listes, désinscription et
--             blocage conservés ; jamais créé ni inscrit).
-- Chaque étape garde son résultat (ok / error / not_needed / pending) ; une
-- reprise (même opération) ne refait jamais une étape déjà « ok ». Une
-- seule opération en cours par fiche. Les commandes et factures gardent
-- leurs coordonnées historiques (rien n'y touche). Aucune fusion.
-- Double clic / deux onglets : une opération ne s'exécute qu'une fois à la
-- fois (customer_email_change_claim, verrou de 2 minutes libéré à la fin).

begin;

create table if not exists public.customer_email_changes (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(id),
  profile_id         uuid references public.profiles(id),
  old_contact_email  text,
  old_login_email    text,
  new_email          text not null,
  identity_checked   boolean not null check (identity_checked),
  idempotency_key    text not null unique,
  steps              jsonb not null default '{}'::jsonb,
  status             text not null default 'in_progress' check (status in ('in_progress', 'completed', 'partial', 'blocked')),
  message            text,
  locked_until       timestamptz,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index if not exists customer_email_changes_customer_idx on public.customer_email_changes (customer_id, created_at desc);
create unique index if not exists customer_email_changes_one_open_uidx on public.customer_email_changes (customer_id)
  where status in ('in_progress', 'partial');
alter table public.customer_email_changes enable row level security;
revoke all on table public.customer_email_changes from public, anon, authenticated;
grant select, insert, update on table public.customer_email_changes to service_role;

alter table public.customer_events drop constraint if exists customer_events_kind_check;
alter table public.customer_events add constraint customer_events_kind_check check (kind in (
  'created', 'updated', 'merged_into', 'absorbed', 'order_relinked',
  'reward_credit', 'account_invite', 'account_resend', 'password_reset', 'login_email_change', 'email_change'));

-- Compte Auth qui utilise déjà cet email (autre que p_except), sinon null.
create or replace function public.admin_auth_email_owner(p_email text, p_except uuid)
returns uuid language sql stable security definer set search_path to '' as $$
  select u.id from auth.users u
  where lower(btrim(u.email)) = lower(btrim(p_email)) and u.id is distinct from p_except
  limit 1;
$$;

-- Vérifications SANS écriture : autre fiche active, autre compte, profil d'un autre compte.
create or replace function public.customer_email_change_conflicts(p_customer uuid, p_new text)
returns jsonb language sql stable set search_path to '' as $$
  with c as (select * from public.customers where id = p_customer)
  select jsonb_build_object(
    'otherCustomer', (select jsonb_build_object('id', o.id, 'name', concat_ws(' ', o.first_name, o.last_name))
                      from public.customers o, c
                      where o.email_norm = public.norm_email(p_new) and o.merged_into is null and o.id <> c.id limit 1),
    'otherAccount', public.admin_auth_email_owner(p_new, (select profile_id from c)) is not null
                    or exists (select 1 from public.profiles p, c where lower(btrim(p.email)) = lower(btrim(p_new)) and p.id is distinct from c.profile_id)
  );
$$;

-- Début ou reprise. Même clé → la même opération. Une opération ouverte
-- (en cours / partielle) pour la même nouvelle adresse est reprise ; pour
-- une autre adresse, refus (terminer d'abord la précédente).
-- p_login : email de connexion lu dans Supabase Auth (sinon celui du profil).
create or replace function public.customer_email_change_begin(p_customer uuid, p_new text, p_key text, p_identity boolean, p_by text, p_login text default null)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_c public.customers%rowtype;
  v_op public.customer_email_changes%rowtype;
  v_new text := lower(btrim(p_new));
  v_login text;
begin
  if coalesce(btrim(p_key), '') = '' then raise exception 'Clé de requête manquante' using errcode = 'P0001'; end if;
  select * into v_op from public.customer_email_changes where idempotency_key = p_key;
  if found then
    if v_op.new_email <> v_new or v_op.customer_id <> p_customer then
      raise exception 'Clé déjà utilisée pour une autre modification : rechargez la fiche' using errcode = 'P0001';
    end if;
    return to_jsonb(v_op) || jsonb_build_object('resumed', true);
  end if;

  if not coalesce(p_identity, false) then
    raise exception 'Confirmez avoir vérifié l''identité du client' using errcode = 'P0001';
  end if;
  if v_new !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Nouvelle adresse invalide' using errcode = 'P0001'; end if;
  select * into v_c from public.customers where id = p_customer for update;
  if not found or v_c.merged_into is not null then raise exception 'Client introuvable ou fusionné' using errcode = 'P0002'; end if;

  select * into v_op from public.customer_email_changes where customer_id = p_customer and status in ('in_progress', 'partial');
  if found then
    if v_op.new_email = v_new then return to_jsonb(v_op) || jsonb_build_object('resumed', true); end if;
    raise exception 'Une modification vers % n''est pas terminée : reprenez-la d''abord', v_op.new_email using errcode = 'P0001';
  end if;

  if v_c.profile_id is not null then
    select coalesce(nullif(btrim(p_login), ''), email) into v_login from public.profiles where id = v_c.profile_id;
  end if;
  if public.norm_email(v_c.email) = v_new and (v_c.profile_id is null or lower(btrim(coalesce(v_login, ''))) = v_new) then
    raise exception 'C''est déjà l''adresse de ce client' using errcode = 'P0001';
  end if;

  insert into public.customer_email_changes (customer_id, profile_id, old_contact_email, old_login_email, new_email, identity_checked,
                                             idempotency_key, steps, created_by)
  values (p_customer, v_c.profile_id, v_c.email, v_login, v_new, true, p_key,
          jsonb_build_object('auth', case when v_c.profile_id is null then 'not_needed' else 'pending' end, 'db', 'pending', 'brevo', 'pending'),
          p_by)
  returning * into v_op;
  return to_jsonb(v_op) || jsonb_build_object('resumed', false);
end;
$$;

-- Verrou d'exécution : true si cet appel peut exécuter les étapes maintenant.
create or replace function public.customer_email_change_claim(p_op uuid)
returns boolean language plpgsql set search_path to '' as $$
begin
  update public.customer_email_changes set locked_until = now() + interval '2 minutes', updated_at = now()
   where id = p_op and status <> 'completed' and (locked_until is null or locked_until < now());
  return found;
end;
$$;

-- Résultat d'une étape (et message lisible).
create or replace function public.customer_email_change_step(p_op uuid, p_step text, p_result text, p_message text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_op public.customer_email_changes%rowtype;
begin
  if p_step not in ('auth', 'db', 'brevo') or p_result not in ('ok', 'error', 'not_needed', 'pending') then
    raise exception 'Étape inconnue' using errcode = 'P0001';
  end if;
  update public.customer_email_changes
     set steps = steps || jsonb_build_object(p_step, p_result)
                       || case when p_message is null then '{}'::jsonb else jsonb_build_object(p_step || '_message', p_message) end,
         updated_at = now()
   where id = p_op
  returning * into v_op;
  return to_jsonb(v_op);
end;
$$;

-- Étape « db » : profil + fiche dans une seule transaction (idempotente).
create or replace function public.customer_email_change_apply_db(p_op uuid)
returns void language plpgsql set search_path to '' as $$
declare v_op public.customer_email_changes%rowtype; v_dup uuid;
begin
  select * into v_op from public.customer_email_changes where id = p_op for update;
  if not found then raise exception 'Opération introuvable' using errcode = 'P0002'; end if;
  select id into v_dup from public.customers
   where email_norm = public.norm_email(v_op.new_email) and merged_into is null and id <> v_op.customer_id limit 1;
  if found then raise exception 'Une autre fiche utilise déjà cette adresse' using errcode = 'P0001'; end if;
  -- Fiche d'abord : le déclencheur du profil voit alors une fiche déjà à jour (pas d'alerte d'écart).
  update public.customers set email = v_op.new_email, updated_at = now()
   where id = v_op.customer_id and email is distinct from v_op.new_email;
  if v_op.profile_id is not null then
    update public.profiles set email = v_op.new_email, updated_at = now()
     where id = v_op.profile_id and email is distinct from v_op.new_email;
  end if;
end;
$$;

-- Fin : statut global + une ligne dans l'historique de la fiche.
create or replace function public.customer_email_change_finish(p_op uuid, p_status text, p_message text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_op public.customer_email_changes%rowtype;
begin
  if p_status not in ('completed', 'partial', 'blocked') then raise exception 'Statut inconnu' using errcode = 'P0001'; end if;
  update public.customer_email_changes
     set status = p_status, message = p_message, updated_at = now(), locked_until = null, finished_at = case when p_status = 'partial' then null else now() end
   where id = p_op
  returning * into v_op;
  insert into public.customer_events (customer_id, kind, detail, created_by)
  values (v_op.customer_id, 'email_change', jsonb_build_object(
    'operation', v_op.id, 'from_contact', v_op.old_contact_email, 'from_login', v_op.old_login_email, 'to', v_op.new_email,
    'status', p_status, 'steps', v_op.steps, 'message', p_message, 'result', case when p_status = 'completed' then 'ok' else 'error' end),
    v_op.created_by);
  return to_jsonb(v_op);
end;
$$;

-- Dernière opération (pour afficher une reprise en attente).
create or replace function public.customer_email_change_latest(p_customer uuid)
returns jsonb language sql stable set search_path to '' as $$
  select to_jsonb(o) - 'idempotency_key' || jsonb_build_object('key', o.idempotency_key)
  from public.customer_email_changes o where o.customer_id = p_customer order by o.created_at desc limit 1;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_auth_email_owner(text, uuid)', 'customer_email_change_conflicts(uuid, text)',
    'customer_email_change_begin(uuid, text, text, boolean, text, text)', 'customer_email_change_claim(uuid)',
    'customer_email_change_step(uuid, text, text, text)',
    'customer_email_change_apply_db(uuid)', 'customer_email_change_finish(uuid, text, text)', 'customer_email_change_latest(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
