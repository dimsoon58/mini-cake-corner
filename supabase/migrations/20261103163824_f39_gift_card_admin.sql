-- F39 (03.11.2026) — Bons cadeaux, step 3: Admin › Bons cadeaux.
-- Read: list with each voucher's uses, summary for a period. Write (PIN,
-- through manage-gift-cards): voucher created by hand (studio sale, giveaway,
-- goodwill gesture), deactivate / reactivate, change the expiry date, put an
-- amount back on the voucher of an order (partial cancellation). Every write
-- is logged in gift_card_events. Service role only.
begin;

-- ── 1. Columns ──────────────────────────────────────────────────────────
-- A voucher made by hand may have no email (handed over printed).
alter table public.gift_cards alter column buyer_email drop not null;
alter table public.gift_cards drop constraint if exists gift_cards_buyer_email_check;
alter table public.gift_cards add constraint gift_cards_buyer_email_check
  check (buyer_email is null or length(buyer_email) between 3 and 254);
alter table public.gift_cards drop constraint if exists gift_cards_online_has_email;
alter table public.gift_cards add constraint gift_cards_online_has_email
  check (source <> 'online' or buyer_email is not null);
alter table public.gift_cards
  add column if not exists note text check (note is null or length(note) <= 500),
  add column if not exists created_by text;

-- ── 2. History ──────────────────────────────────────────────────────────
create table if not exists public.gift_card_events (
  id           uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id),
  action       text not null check (action in ('create_manual', 'disable', 'enable', 'expiry', 'recredit', 'email_resent')),
  amount       numeric(10,2),
  order_id     uuid,
  detail       jsonb not null default '{}'::jsonb,
  actor        text,
  created_at   timestamptz not null default now()
);
create index if not exists gift_card_events_card_idx on public.gift_card_events (gift_card_id, created_at);
alter table public.gift_card_events enable row level security;
revoke all on table public.gift_card_events from public, anon, authenticated;
grant all on table public.gift_card_events to service_role;

-- ── 3. List ─────────────────────────────────────────────────────────────
-- p_status: 'all' | 'active' (usable now) | 'used' (balance 0) | 'expired' | 'disabled'
create or replace function public.admin_gift_card_list(p_search text default null, p_status text default 'all')
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'paidAt') desc nulls last, x ->> 'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', g.id, 'code', g.code, 'initialAmount', g.initial_amount, 'balance', g.balance, 'status', g.status, 'source', g.source,
      'buyerName', g.buyer_name, 'buyerEmail', g.buyer_email, 'recipientName', g.recipient_name, 'message', g.message, 'note', g.note,
      'lang', g.lang, 'paidAt', g.paid_at, 'expiresAt', g.expires_at, 'createdAt', g.created_at, 'createdBy', g.created_by,
      'emailStatus', g.email_status, 'emailSentAt', g.email_sent_at,
      'expired', g.expires_at is not null and g.expires_at <= now(),
      'uses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'orderId', r.order_id, 'orderNumber', o.order_number, 'amount', r.amount, 'recredited', r.recredited_amount,
          'status', r.status, 'at', coalesce(r.consumed_at, r.created_at),
          'customer', nullif(btrim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')), '')) order by r.created_at)
        from public.gift_card_reservations r left join public.orders o on o.id = r.order_id
        where r.gift_card_id = g.id and r.status <> 'released'), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('action', e.action, 'amount', e.amount, 'orderId', e.order_id, 'detail', e.detail, 'actor', e.actor, 'at', e.created_at) order by e.created_at)
        from public.gift_card_events e where e.gift_card_id = g.id), '[]'::jsonb)
    ) as x
    from public.gift_cards g
    where g.status in ('active', 'disabled')
      and (p_search is null or btrim(p_search) = ''
           or g.code ilike '%' || btrim(p_search) || '%'
           or g.buyer_name ilike '%' || btrim(p_search) || '%'
           or coalesce(g.buyer_email, '') ilike '%' || btrim(p_search) || '%'
           or coalesce(g.recipient_name, '') ilike '%' || btrim(p_search) || '%')
      and (coalesce(p_status, 'all') = 'all'
           or (p_status = 'active' and g.status = 'active' and g.expires_at > now() and g.balance > 0)
           or (p_status = 'used' and g.status = 'active' and g.balance <= 0)
           or (p_status = 'expired' and g.status = 'active' and g.expires_at <= now() and g.balance > 0)
           or (p_status = 'disabled' and g.status = 'disabled'))
    limit 500
  ) t;
$$;

-- ── 4. Summary (period in Geneva days) ──────────────────────────────────
-- sold          : vouchers paid online in the period (money received by PostFinance)
-- manual        : vouchers made by hand in the period (no money through the site)
-- used          : voucher money spent on orders accepted in the period, minus what was put back
-- expiredUnused : balance left on vouchers that expired in the period
-- outstanding   : what is still on usable vouchers today (owed to customers)
create or replace function public.admin_gift_card_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sold', jsonb_build_object(
      'count', (select count(*) from public.gift_cards g where g.source = 'online' and g.status in ('active', 'disabled')
                 and (g.paid_at at time zone 'Europe/Zurich')::date between p_from and p_to),
      'amount', (select coalesce(sum(g.initial_amount), 0) from public.gift_cards g where g.source = 'online' and g.status in ('active', 'disabled')
                 and (g.paid_at at time zone 'Europe/Zurich')::date between p_from and p_to)),
    'manual', jsonb_build_object(
      'count', (select count(*) from public.gift_cards g where g.source = 'manual'
                 and (g.created_at at time zone 'Europe/Zurich')::date between p_from and p_to),
      'amount', (select coalesce(sum(g.initial_amount), 0) from public.gift_cards g where g.source = 'manual'
                 and (g.created_at at time zone 'Europe/Zurich')::date between p_from and p_to)),
    'used', (select coalesce(sum(r.amount - r.recredited_amount), 0) from public.gift_card_reservations r
              where r.status in ('consumed', 'recredited') and (r.consumed_at at time zone 'Europe/Zurich')::date between p_from and p_to),
    'expiredUnused', (select coalesce(sum(g.balance), 0) from public.gift_cards g where g.status = 'active' and g.balance > 0
              and (g.expires_at at time zone 'Europe/Zurich')::date between p_from and p_to and g.expires_at <= now()),
    'outstanding', (select coalesce(sum(g.balance), 0) from public.gift_cards g where g.status = 'active' and g.expires_at > now()),
    'outstandingCount', (select count(*) from public.gift_cards g where g.status = 'active' and g.expires_at > now() and g.balance > 0)
  );
$$;

-- ── 5. Writes ───────────────────────────────────────────────────────────
-- The code is drawn by the Edge Function (same generator as online vouchers).
create or replace function public.gift_card_create_manual(
  p_code text, p_amount numeric, p_buyer_name text, p_buyer_email text, p_recipient text,
  p_message text, p_lang text, p_months integer, p_note text, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.gift_cards%rowtype;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 2000 then raise exception 'Montant invalide (1 à 2000 CHF)' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_buyer_name, '')), '') is null then raise exception 'Nom obligatoire' using errcode = 'P0001'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'Validité invalide (1 à 36 mois)' using errcode = 'P0001'; end if;
  insert into public.gift_cards (code, initial_amount, balance, status, source, buyer_name, buyer_email, recipient_name, message, lang,
                                 paid_at, expires_at, email_status, note, created_by)
  values (p_code, round(p_amount, 2), round(p_amount, 2), 'active', 'manual', btrim(p_buyer_name), nullif(lower(btrim(coalesce(p_buyer_email, ''))), ''),
          nullif(btrim(coalesce(p_recipient, '')), ''), nullif(btrim(coalesce(p_message, '')), ''), case when p_lang = 'en' then 'en' else 'fr' end,
          now(), now() + make_interval(months => p_months), 'pending', nullif(btrim(coalesce(p_note, '')), ''), p_by)
  returning * into v_row;
  insert into public.gift_card_events (gift_card_id, action, amount, detail, actor)
  values (v_row.id, 'create_manual', v_row.initial_amount, jsonb_build_object('months', p_months), p_by);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.gift_card_set_status(p_id uuid, p_active boolean, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.gift_cards%rowtype;
begin
  select * into v_row from public.gift_cards where id = p_id for update;
  if not found or v_row.status not in ('active', 'disabled') then raise exception 'Bon cadeau introuvable' using errcode = 'P0002'; end if;
  if (v_row.status = 'active') = p_active then return to_jsonb(v_row); end if;
  update public.gift_cards set status = case when p_active then 'active' else 'disabled' end, updated_at = now() where id = p_id returning * into v_row;
  insert into public.gift_card_events (gift_card_id, action, actor) values (p_id, case when p_active then 'enable' else 'disable' end, p_by);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.gift_card_set_expiry(p_id uuid, p_expires date, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.gift_cards%rowtype;
  v_old timestamptz;
begin
  if p_expires is null then raise exception 'Date obligatoire' using errcode = 'P0001'; end if;
  select * into v_row from public.gift_cards where id = p_id for update;
  if not found or v_row.status not in ('active', 'disabled') then raise exception 'Bon cadeau introuvable' using errcode = 'P0002'; end if;
  v_old := v_row.expires_at;
  -- Valid until the end of that Geneva day.
  update public.gift_cards
     set expires_at = ((p_expires + 1)::timestamp at time zone 'Europe/Zurich') - interval '1 second', updated_at = now()
   where id = p_id returning * into v_row;
  insert into public.gift_card_events (gift_card_id, action, detail, actor)
  values (p_id, 'expiry', jsonb_build_object('from', v_old, 'to', v_row.expires_at), p_by);
  return to_jsonb(v_row);
end;
$$;

-- Puts an amount back on the voucher that paid an order (partial
-- cancellation). Never more than what the voucher paid minus what was
-- already put back (recredit_gift_card_for_order caps it).
create or replace function public.gift_card_recredit_order(p_order_id uuid, p_amount numeric, p_by text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res  public.gift_card_reservations%rowtype;
  v_back numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  select * into v_res from public.gift_card_reservations where order_id = p_order_id;
  if not found then raise exception 'Cette commande n''a pas été payée avec un bon cadeau' using errcode = 'P0002'; end if;
  if v_res.status = 'reserved' then raise exception 'Commande pas encore acceptée : refusez-la pour rendre le bon en entier' using errcode = 'P0001'; end if;
  if v_res.status = 'released' then raise exception 'Le bon a déjà été rendu en entier' using errcode = 'P0001'; end if;
  if round(p_amount, 2) > v_res.amount - v_res.recredited_amount then
    raise exception 'Maximum possible : CHF %', to_char(v_res.amount - v_res.recredited_amount, 'FM999990.00') using errcode = 'P0001';
  end if;
  v_back := public.recredit_gift_card_for_order(p_order_id, round(p_amount, 2));
  insert into public.gift_card_events (gift_card_id, action, amount, order_id, actor) values (v_res.gift_card_id, 'recredit', v_back, p_order_id, p_by);
  return jsonb_build_object('recredited', v_back);
end;
$$;

-- The voucher part of one order (Admin order page).
create or replace function public.admin_gift_card_for_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('giftCardId', g.id, 'code', g.code, 'amount', r.amount, 'recredited', r.recredited_amount,
                            'status', r.status, 'balance', g.balance, 'expiresAt', g.expires_at)
  from public.gift_card_reservations r join public.gift_cards g on g.id = r.gift_card_id
  where r.order_id = p_order_id;
$$;

create or replace function public.gift_card_log_email(p_id uuid, p_by text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.gift_card_events (gift_card_id, action, actor) values (p_id, 'email_resent', p_by);
$$;

-- ── 6. Grants ───────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_gift_card_list(text, text)', 'public.admin_gift_card_summary(date, date)',
    'public.gift_card_create_manual(text, numeric, text, text, text, text, text, integer, text, text)',
    'public.gift_card_set_status(uuid, boolean, text)', 'public.gift_card_set_expiry(uuid, date, text)',
    'public.gift_card_recredit_order(uuid, numeric, text)', 'public.admin_gift_card_for_order(uuid)',
    'public.gift_card_log_email(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;

-- Checks (expected: 0 | t | 8):
-- select count(*) from public.gift_card_events;
-- select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'gift_cards' and column_name = 'buyer_email';
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
--   and p.proname in ('admin_gift_card_list', 'admin_gift_card_summary', 'gift_card_create_manual', 'gift_card_set_status',
--                     'gift_card_set_expiry', 'gift_card_recredit_order', 'admin_gift_card_for_order', 'gift_card_log_email');
