-- F24 — Préparer la sortie de Notion et Make (décision du 2026-10-04).
--
-- À appliquer après F23. Ne rejoue aucune migration, ne modifie aucune
-- commande, aucune réservation, aucune session existante. Additive,
-- relançable. RIEN NE CHANGE tant que les réglages ne sont pas basculés :
--   notion_sync_enabled  = true  (synchronisation Notion active, comme aujourd'hui)
--   daily_report_enabled = false (le rapport de 8 h reste celui de Make, 7325098)
--
-- 1. app_settings : réglages lus par les fonctions et la base (un seul
--    endroit), historisés. public.app_setting_bool(clé, défaut) ; une clé
--    absente ou illisible vaut le défaut (donc « Notion actif »).
-- 2. order_health_anomalies : le cas « SYNCHRO_NOTION » n'apparaît que si
--    notion_sync_enabled est vrai (les 5 autres cas sont recopiés à
--    l'identique de la photo de production du 30.09). order_health_summary
--    (rapport de 8 h) en dépend : même effet.
-- 3. Déclencheurs make_* (pg_net vers Make) : mêmes conditions qu'avant, plus
--    « notion_sync_enabled ». Les fonctions qu'ils appellent (et leurs URL,
--    seulement en production) ne sont PAS modifiées.
-- 4. Rapport quotidien Supabase : journal daily_report_runs (une ligne par
--    jour = un seul e-mail par jour, jamais deux) ; la tâche planifiée est
--    dans deferred-migrations/ (appliquée seulement à la bascule).
-- 5. Sessions workshop : lecture admin (places occupées, réservations),
--    création et modification avec règles (capacité jamais sous les places
--    occupées, changement de date / heure confirmé explicitement quand des
--    personnes sont inscrites, type jamais changé s'il y a des réservations,
--    pas de suppression : « fermer » à la place). Les réservations et leurs
--    prix restent inchangés (prix figé sur chaque réservation / article).

begin;

-- ── 1. Réglages ──────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (key, value, description, updated_by) values
  ('notion_sync_enabled', 'true'::jsonb, 'Synchronisation vers Notion (Make) et alertes Notion. false = le site ne l''attend plus.', 'migration F24'),
  ('daily_report_enabled', 'false'::jsonb, 'Rapport quotidien de 8 h envoyé par Supabase (remplace le scénario Make 7325098).', 'migration F24')
on conflict (key) do nothing;

create table if not exists public.app_settings_audit (
  id         bigint generated always as identity primary key,
  key        text not null,
  before     jsonb,
  after      jsonb,
  actor      text,
  created_at timestamptz not null default now()
);
create or replace function public.trg_app_settings_audit()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.app_settings_audit (key, before, after, actor)
  values (coalesce(new.key, old.key), case when tg_op <> 'INSERT' then old.value end, case when tg_op <> 'DELETE' then new.value end,
          coalesce(new.updated_by, old.updated_by));
  return null;
end;
$$;
drop trigger if exists trg_app_settings_audit on public.app_settings;
create trigger trg_app_settings_audit after insert or update or delete on public.app_settings for each row execute function public.trg_app_settings_audit();

-- Lecture sûre : défaut si la clé manque ou n'est pas un booléen.
create or replace function public.app_setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select case jsonb_typeof(value) when 'boolean' then (value)::text::boolean end from public.app_settings where key = p_key), p_default);
$$;
create or replace function public.notion_sync_enabled()
returns boolean language sql stable security definer set search_path to '' as $$
  select public.app_setting_bool('notion_sync_enabled', true);
$$;

-- ── 2. Alertes : le cas Notion seulement si la synchronisation est active ─
create or replace view public.order_health_anomalies with (security_invoker = true) as
 SELECT o.id AS order_id, o.order_number, 'PAIEMENT_SANS_REFERENCE'::text AS issue_type,
    'Commande website marquée paid sans référence PostFinance.'::text AS detail, o.created_at
   FROM public.orders o
  WHERE o.order_source = 'website'::text AND o.payment_status = 'paid'::public.payment_status
    AND (o.postfinance_transaction_id IS NULL OR btrim(o.postfinance_transaction_id) = ''::text)
UNION ALL
 SELECT o.id AS order_id, o.order_number, 'SYNCHRO_NOTION'::text AS issue_type,
    'Statut Notion = '::text || COALESCE(o.notion_sync_status, 'NULL'::text) AS detail, o.created_at
   FROM public.orders o
  WHERE public.notion_sync_enabled()
    AND o.order_source = 'website'::text AND o.payment_status = 'paid'::public.payment_status AND o.notion_sync_status <> 'synced'::text
    AND o.created_at <= (now() - '00:15:00'::interval)
    AND (EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND oi.product <> 'workshop'::public.product_type))
UNION ALL
 SELECT o.id AS order_id, o.order_number, 'COMMANDE_SANS_ARTICLE'::text AS issue_type,
    'Commande website enregistrée sans order_items après 15 minutes.'::text AS detail, o.created_at
   FROM public.orders o
  WHERE o.order_source = 'website'::text AND o.created_at <= (now() - '00:15:00'::interval)
    AND (COALESCE(o.order_validation::text, ''::text) <> ALL (ARRAY['cancelled'::text, 'rejected'::text]))
    AND NOT (EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id))
UNION ALL
 SELECT o.id AS order_id, o.order_number, 'PAIEMENT_PENDING_RESIDUEL'::text AS issue_type,
    'Commande paid encore présente dans pending_payments.'::text AS detail, o.created_at
   FROM public.orders o JOIN public.pending_payments pp ON pp.order_id = o.id
  WHERE o.payment_status = 'paid'::public.payment_status
UNION ALL
 SELECT o.id AS order_id, o.order_number, 'EMAIL_MANUEL_EN_ERREUR'::text AS issue_type,
    'Confirmation/facture manuelle en statut error.'::text AS detail, o.created_at
   FROM public.orders o
  WHERE o.order_source <> 'website'::text AND o.payment_status = 'paid'::public.payment_status AND o.manual_confirmation_status = 'error'::text
UNION ALL
 SELECT o.id AS order_id, o.order_number, 'ECHEC_COMMANDE_NON_RESOLU'::text AS issue_type,
    COALESCE(o.order_failure_reason, 'Échec commande'::text) AS detail, o.created_at
   FROM public.orders o
  WHERE o.order_failure_reason IS NOT NULL
    AND NOT (o.order_validation = 'rejected'::public.order_validation_status AND (o.payment_status = ANY (ARRAY['cancelled'::public.payment_status, 'refunded'::public.payment_status])));

-- ── 3. Envois vers Make depuis la base : seulement si Notion est actif ────
drop trigger if exists make_order_payment_status_change on public.orders;
create trigger make_order_payment_status_change AFTER UPDATE OF payment_status ON public.orders FOR EACH ROW
  WHEN (((old.payment_status IS DISTINCT FROM new.payment_status) AND (new.created_via IS DISTINCT FROM 'admin'::text)) AND public.notion_sync_enabled())
  EXECUTE FUNCTION public.notify_make_order_payment_status_change();
drop trigger if exists make_new_profile on public.profiles;
create trigger make_new_profile AFTER INSERT ON public.profiles FOR EACH ROW
  WHEN (public.notion_sync_enabled())
  EXECUTE FUNCTION public.notify_make_new_profile();
drop trigger if exists make_reward_balance_change on public.profiles;
create trigger make_reward_balance_change AFTER UPDATE OF reward_balance, welcome_discount_available, welcome_discount_used_at, welcome_discount_expires_at, newsletter_subscription
  ON public.profiles FOR EACH ROW
  WHEN (((old.reward_balance IS DISTINCT FROM new.reward_balance) OR (old.welcome_discount_available IS DISTINCT FROM new.welcome_discount_available)
         OR (old.welcome_discount_used_at IS DISTINCT FROM new.welcome_discount_used_at) OR (old.welcome_discount_expires_at IS DISTINCT FROM new.welcome_discount_expires_at)
         OR (old.newsletter_subscription IS DISTINCT FROM new.newsletter_subscription)) AND public.notion_sync_enabled())
  EXECUTE FUNCTION public.notify_make_reward_balance_change();

-- ── 4. Rapport quotidien (journal : un envoi par jour au plus) ────────────
create table if not exists public.daily_report_runs (
  report_date   date primary key,
  status        text not null default 'running' check (status in ('running', 'sent', 'no_anomaly', 'error')),
  anomaly_count integer,
  summary       text,
  email_id      text,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
-- Réserve le jour (true) ; un 2e appel le même jour → false, rien n'est renvoyé.
-- Une tentative en erreur peut être reprise le même jour (et seulement elle).
create or replace function public.daily_report_claim(p_date date)
returns boolean language plpgsql set search_path to '' as $$
begin
  insert into public.daily_report_runs (report_date) values (p_date) on conflict (report_date) do nothing;
  if found then return true; end if;
  update public.daily_report_runs set status = 'running', error = null, created_at = now()
   where report_date = p_date and status = 'error';
  return found;
end;
$$;
create or replace function public.daily_report_finish(p_date date, p_status text, p_count integer, p_summary text, p_email_id text, p_error text)
returns void language sql set search_path to '' as $$
  update public.daily_report_runs set status = p_status, anomaly_count = p_count, summary = p_summary, email_id = p_email_id,
         error = p_error, finished_at = now()
   where report_date = p_date;
$$;
create or replace function public.daily_report_summary()
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('anomalyCount', s.anomaly_count, 'summary', s.summary_text,
    'items', coalesce((select jsonb_agg(jsonb_build_object('orderNumber', a.order_number, 'issueType', a.issue_type, 'detail', a.detail) order by a.created_at desc)
                       from public.order_health_anomalies a), '[]'::jsonb))
  from public.order_health_summary s;
$$;

-- ── 5. Sessions workshop ─────────────────────────────────────────────────
create table if not exists public.workshop_session_audit (
  id         bigint generated always as identity primary key,
  session_id text not null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  actor      text,
  created_at timestamptz not null default now()
);

create or replace function public.admin_workshop_sessions()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'time'), '[]'::jsonb) from (
    select jsonb_build_object('id', s.id, 'type', s.workshop_type, 'date', s.workshop_date, 'time', s.workshop_time,
      'unitPrice', s.unit_price, 'capacity', s.max_capacity, 'isOpen', s.is_open, 'updatedAt', s.updated_at,
      'occupied', coalesce(r.occupied, 0), 'remaining', greatest(s.max_capacity - coalesce(r.occupied, 0), 0),
      'reservations', coalesce(r.n, 0), 'cancelledSeats', coalesce(r.cancelled, 0)) as x
    from public.workshop_sessions s
    left join (select workshop_session_id, count(*) filter (where status in ('pending', 'confirmed', 'partially_cancelled')) as n,
                      sum(purchased_seats - cancelled_seats) filter (where status in ('pending', 'confirmed', 'partially_cancelled')) as occupied,
                      sum(cancelled_seats) as cancelled
               from public.workshop_reservations group by workshop_session_id) r on r.workshop_session_id = s.id
  ) t;
$$;

-- Créer (p_id null) ou modifier. Renvoie { needsConfirm, message } sans rien
-- écrire quand un changement touche des personnes déjà inscrites et n'a pas
-- été confirmé.
create or replace function public.admin_workshop_session_save(
  p_id text, p_type text, p_date date, p_time text, p_price numeric, p_capacity integer, p_open boolean, p_confirm boolean, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_old public.workshop_sessions%rowtype;
  v_occupied integer := 0;
  v_reservations integer := 0;
  v_id text := nullif(btrim(p_id), '');
  v_row public.workshop_sessions%rowtype;
begin
  if p_type not in ('signature', 'paint') then raise exception 'Type de workshop inconnu' using errcode = 'P0001'; end if;
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
       set workshop_type = p_type, workshop_date = p_date, workshop_time = p_time, unit_price = round(p_price, 2), max_capacity = p_capacity,
           is_open = coalesce(p_open, v_old.is_open), updated_at = now()
     where id = v_id returning * into v_row;
    insert into public.workshop_session_audit (session_id, action, before, after, actor) values (v_id, 'update', to_jsonb(v_old), to_jsonb(v_row), p_by);
  else
    if exists (select 1 from public.workshop_sessions where workshop_type = p_type and workshop_date = p_date and workshop_time = p_time) then
      raise exception 'Une session de ce type existe déjà à cette date et cette heure' using errcode = 'P0001';
    end if;
    v_id := (case p_type when 'signature' then 'sig' else 'paint' end) || '-' || to_char(p_date, 'YYYY-MM-DD');
    if exists (select 1 from public.workshop_sessions where id = v_id) then v_id := v_id || '-' || replace(p_time, ':', ''); end if;
    if exists (select 1 from public.workshop_sessions where id = v_id) then
      raise exception 'Une session de ce type existe déjà à cette date et cette heure' using errcode = 'P0001';
    end if;
    insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open)
    values (v_id, p_type, p_date, p_time, round(p_price, 2), p_capacity, coalesce(p_open, true)) returning * into v_row;
    insert into public.workshop_session_audit (session_id, action, before, after, actor) values (v_id, 'create', null, to_jsonb(v_row), p_by);
  end if;
  return jsonb_build_object('needsConfirm', false, 'session', to_jsonb(v_row));
end;
$$;

create or replace function public.admin_workshop_session_history(p_id text)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after, 'actor', actor, 'at', created_at) order by id desc), '[]'::jsonb)
  from public.workshop_session_audit where session_id = p_id;
$$;

-- ── Accès ────────────────────────────────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['app_settings', 'app_settings_audit', 'daily_report_runs', 'workshop_session_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'trg_app_settings_audit()', 'daily_report_claim(date)', 'daily_report_finish(date, text, integer, text, text, text)', 'daily_report_summary()',
    'admin_workshop_sessions()', 'admin_workshop_session_save(text, text, date, text, numeric, integer, boolean, boolean, text)',
    'admin_workshop_session_history(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
  -- Lus par la vue (security_invoker) et les déclencheurs : exécutables par tous, ne renvoient qu'un booléen.
  execute 'revoke all on function public.app_setting_bool(text, boolean) from public';
  execute 'grant execute on function public.app_setting_bool(text, boolean) to anon, authenticated, service_role';
  execute 'revoke all on function public.notion_sync_enabled() from public';
  execute 'grant execute on function public.notion_sync_enabled() to anon, authenticated, service_role';
end $$;

commit;
