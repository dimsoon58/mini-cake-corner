-- F16 — PIN admin demandé une seule fois par session de connexion.
--
-- Indépendante de F15 (stock). Ne rejoue aucune migration. Ne touche ni
-- aux paiements, ni aux commandes, ni à Make, ni à Notion.
--
-- Principe (validé le 2026-10-03) :
--   * Connexion inchangée : Supabase Auth par email (Mel, Eli), liste
--     d'admins dans _shared/admin-auth.ts. Pas de deuxième système.
--   * Après connexion, le PIN (secret ADMIN_ORDER_PIN) est vérifié UNE fois
--     par la fonction admin-pin. Elle crée une « autorisation de session » :
--     un jeton aléatoire, dont seule l'empreinte SHA-256 est stockée ici,
--     lié à l'email ET à la session de connexion (claim session_id du JWT),
--     avec une expiration. Le PIN n'est jamais stocké.
--   * Chaque appel admin reste vérifié côté serveur (requireAdmin : session
--     Supabase + liste d'admins) ; le jeton remplace la ressaisie du PIN
--     pour les actions protégées. Déconnexion, nouvelle connexion ou
--     expiration → le jeton ne vaut plus rien → PIN redemandé.
--   * Tentatives limitées : 5 échecs en 15 minutes bloquent le PIN 15 min.
--
-- Additive, relançable. Service role uniquement.

begin;

create table if not exists public.admin_pin_sessions (
  id              uuid primary key default gen_random_uuid(),
  admin_email     text not null,
  auth_session_id text not null default '',
  token_hash      text not null unique,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text,
  user_agent      text
);
create index if not exists admin_pin_sessions_active_idx on public.admin_pin_sessions (admin_email, auth_session_id) where revoked_at is null;

create table if not exists public.admin_pin_attempts (
  id          uuid primary key default gen_random_uuid(),
  admin_email text not null,
  at          timestamptz not null default now(),
  success     boolean not null
);
create index if not exists admin_pin_attempts_email_idx on public.admin_pin_attempts (admin_email, at desc);

-- Échecs récents (blocage temporaire).
create or replace function public.admin_pin_recent_failures(p_email text, p_minutes integer)
returns integer language sql stable set search_path to '' as $$
  select count(*)::integer from public.admin_pin_attempts a
  where a.admin_email = lower(p_email) and not a.success
    and a.at > now() - make_interval(mins => greatest(coalesce(p_minutes, 15), 1))
    and a.at > coalesce((select max(s.at) from public.admin_pin_attempts s where s.admin_email = lower(p_email) and s.success), '-infinity');
$$;

create or replace function public.admin_pin_record_attempt(p_email text, p_success boolean)
returns void language sql set search_path to '' as $$
  insert into public.admin_pin_attempts (admin_email, success) values (lower(p_email), p_success);
$$;

-- Ouvre une autorisation (après vérification du PIN par la fonction Edge).
-- Une seule autorisation active par email + session de connexion.
create or replace function public.admin_pin_open(p_email text, p_session text, p_token_hash text, p_hours numeric, p_user_agent text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_row public.admin_pin_sessions;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Jeton invalide' using errcode = 'P0001'; end if;
  update public.admin_pin_sessions set revoked_at = now(), revoked_reason = 'remplacée'
   where admin_email = lower(p_email) and auth_session_id = coalesce(p_session, '') and revoked_at is null;
  insert into public.admin_pin_sessions (admin_email, auth_session_id, token_hash, expires_at, user_agent)
  values (lower(p_email), coalesce(p_session, ''), p_token_hash,
          now() + make_interval(mins => (least(greatest(coalesce(p_hours, 12), 0.25), 24) * 60)::integer),
          left(coalesce(p_user_agent, ''), 300))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'expiresAt', v_row.expires_at);
end $$;

-- Vérifie un jeton : même email, même session de connexion, pas révoqué,
-- pas expiré. Renvoie l'expiration, ou null.
create or replace function public.admin_pin_check(p_email text, p_session text, p_token_hash text)
returns timestamptz language sql stable set search_path to '' as $$
  select s.expires_at from public.admin_pin_sessions s
  where s.token_hash = p_token_hash and s.admin_email = lower(p_email)
    and s.auth_session_id = coalesce(p_session, '') and s.revoked_at is null and s.expires_at > now()
  limit 1;
$$;

-- Révoque (déconnexion / verrouillage).
create or replace function public.admin_pin_revoke(p_email text, p_token_hash text, p_reason text)
returns integer language plpgsql set search_path to '' as $$
declare n integer;
begin
  update public.admin_pin_sessions set revoked_at = now(), revoked_reason = left(coalesce(p_reason, 'déconnexion'), 100)
   where admin_email = lower(p_email) and token_hash = p_token_hash and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

do $$
declare t text; f text;
begin
  foreach t in array array['admin_pin_sessions', 'admin_pin_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'admin_pin_recent_failures(text, integer)', 'admin_pin_record_attempt(text, boolean)',
    'admin_pin_open(text, text, text, numeric, text)', 'admin_pin_check(text, text, text)',
    'admin_pin_revoke(text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
