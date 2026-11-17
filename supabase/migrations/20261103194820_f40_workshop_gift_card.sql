-- F40 (03.11.2026) — « Offrir un workshop »: a workshop gift voucher.
-- Bought for a workshop type (signature / piping / paint) and 1 to 6
-- places; its value is the price × places. The person who receives it can
-- book ANY workshop with it (a dearer one: the difference is paid by card;
-- a cheaper one: the rest stays on the code) — workshops only, never cakes.
-- Same table, lifecycle and admin page as the amount vouchers.
begin;

-- ── 1. Columns ──────────────────────────────────────────────────────────
alter table public.gift_cards
  add column if not exists kind text not null default 'amount',
  add column if not exists workshop_type text,
  add column if not exists workshop_places integer;
alter table public.gift_cards drop constraint if exists gift_cards_kind_check;
alter table public.gift_cards add constraint gift_cards_kind_check check (
  (kind = 'amount' and workshop_type is null and workshop_places is null)
  or (kind = 'workshop' and workshop_type is not null and workshop_places is not null
      and workshop_type in ('signature', 'piping', 'paint') and workshop_places between 1 and 6));

-- ── 2. Lookup (cart) also tells the kind ────────────────────────────────
create or replace function public.gift_card_lookup(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_card      public.gift_cards%rowtype;
  v_available numeric(10,2);
begin
  select * into v_card from public.gift_cards where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_card.status = 'disabled' then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if v_card.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_card.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired', 'expiresAt', v_card.expires_at); end if;
  v_available := v_card.balance + coalesce((
    select sum(r.amount) from public.gift_card_reservations r
     where r.gift_card_id = v_card.id and r.status = 'reserved'
       and not exists (select 1 from public.orders o where o.id = r.order_id)
       and (not exists (select 1 from public.pending_payments pp where pp.order_id = r.order_id)
            or r.created_at < now() - interval '24 hours')), 0);
  v_available := least(v_available, v_card.initial_amount);
  if v_available <= 0 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  return jsonb_build_object('ok', true, 'code', v_card.code, 'balance', v_available, 'expiresAt', v_card.expires_at,
    'kind', v_card.kind, 'workshopType', v_card.workshop_type, 'workshopPlaces', v_card.workshop_places);
end;
$$;

-- ── 3. Reserve: a workshop voucher pays the workshop lines only ─────────
-- p_workshop_max = what the order's workshop lines still cost (computed by
-- create-postfinance-payment). Returns 'kind' so the payment knows where
-- to put the amount.
create or replace function public.reserve_gift_card(p_code text, p_order_id uuid, p_max_amount numeric, p_workshop_max numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card   public.gift_cards%rowtype;
  v_res    public.gift_card_reservations%rowtype;
  v_amount numeric(10,2);
  v_cap    numeric(10,2);
  v_stale  record;
begin
  if p_order_id is null then raise exception 'gift_card: order id required' using errcode = 'P0001'; end if;
  select * into v_card from public.gift_cards where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or v_card.status not in ('active', 'disabled') then raise exception 'gift_card_unknown' using errcode = 'P0001'; end if;
  if v_card.status = 'disabled' then raise exception 'gift_card_disabled' using errcode = 'P0001'; end if;
  if v_card.expires_at <= now() then raise exception 'gift_card_expired' using errcode = 'P0001'; end if;

  v_cap := greatest(coalesce(p_max_amount, 0), 0);
  if v_card.kind = 'workshop' then
    v_cap := least(v_cap, greatest(coalesce(p_workshop_max, 0), 0));
    if v_cap <= 0 then raise exception 'gift_card_workshop_only' using errcode = 'P0001'; end if;
  end if;

  for v_stale in
    select r.* from public.gift_card_reservations r
     where r.gift_card_id = v_card.id and r.status = 'reserved' and r.order_id <> p_order_id
       and not exists (select 1 from public.orders o where o.id = r.order_id)
       and (not exists (select 1 from public.pending_payments pp where pp.order_id = r.order_id)
            or r.created_at < now() - interval '24 hours')
     for update
  loop
    update public.gift_card_reservations set status = 'released', released_at = now() where id = v_stale.id;
    v_card.balance := least(v_card.initial_amount, v_card.balance + v_stale.amount);
  end loop;

  select * into v_res from public.gift_card_reservations where order_id = p_order_id for update;
  if found then
    if v_res.status <> 'reserved' then raise exception 'gift_card: reservation already closed for this order' using errcode = 'P0001'; end if;
    if v_res.gift_card_id = v_card.id then
      v_card.balance := least(v_card.initial_amount, v_card.balance + v_res.amount);
    else
      update public.gift_cards set balance = least(initial_amount, balance + v_res.amount), updated_at = now() where id = v_res.gift_card_id;
    end if;
    delete from public.gift_card_reservations where id = v_res.id;
  end if;

  v_amount := round(least(v_card.balance, v_cap), 2);
  if v_amount <= 0 then
    update public.gift_cards set balance = v_card.balance, updated_at = now() where id = v_card.id;
    if v_card.balance <= 0 then raise exception 'gift_card_empty' using errcode = 'P0001'; end if;
    return jsonb_build_object('amount', 0, 'giftCardId', v_card.id, 'code', v_card.code, 'kind', v_card.kind, 'balanceAfter', v_card.balance);
  end if;

  update public.gift_cards set balance = v_card.balance - v_amount, updated_at = now() where id = v_card.id;
  insert into public.gift_card_reservations (gift_card_id, order_id, amount) values (v_card.id, p_order_id, v_amount);
  return jsonb_build_object('amount', v_amount, 'giftCardId', v_card.id, 'code', v_card.code, 'kind', v_card.kind, 'balanceAfter', v_card.balance - v_amount);
end;
$$;
drop function if exists public.reserve_gift_card(text, uuid, numeric);

-- ── 4. Voucher made by hand: amount or workshop ─────────────────────────
create or replace function public.gift_card_create_manual(
  p_code text, p_amount numeric, p_buyer_name text, p_buyer_email text, p_recipient text,
  p_message text, p_lang text, p_months integer, p_note text, p_by text,
  p_kind text default 'amount', p_workshop_type text default null, p_workshop_places integer default null)
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
  if coalesce(p_kind, 'amount') = 'workshop' and (p_workshop_type not in ('signature', 'piping', 'paint') or p_workshop_places is null or p_workshop_places not between 1 and 6) then
    raise exception 'Workshop ou nombre de places invalide' using errcode = 'P0001';
  end if;
  insert into public.gift_cards (code, initial_amount, balance, status, source, buyer_name, buyer_email, recipient_name, message, lang,
                                 paid_at, expires_at, email_status, note, created_by, kind, workshop_type, workshop_places)
  values (p_code, round(p_amount, 2), round(p_amount, 2), 'active', 'manual', btrim(p_buyer_name), nullif(lower(btrim(coalesce(p_buyer_email, ''))), ''),
          nullif(btrim(coalesce(p_recipient, '')), ''), nullif(btrim(coalesce(p_message, '')), ''), case when p_lang = 'en' then 'en' else 'fr' end,
          now(), now() + make_interval(months => p_months), 'pending', nullif(btrim(coalesce(p_note, '')), ''), p_by,
          case when p_kind = 'workshop' then 'workshop' else 'amount' end,
          case when p_kind = 'workshop' then p_workshop_type end,
          case when p_kind = 'workshop' then p_workshop_places end)
  returning * into v_row;
  insert into public.gift_card_events (gift_card_id, action, amount, detail, actor)
  values (v_row.id, 'create_manual', v_row.initial_amount, jsonb_build_object('months', p_months, 'kind', v_row.kind), p_by);
  return to_jsonb(v_row);
end;
$$;
drop function if exists public.gift_card_create_manual(text, numeric, text, text, text, text, text, integer, text, text);

-- ── 5. Admin list shows the kind (guarded patch of the F39 function) ────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.admin_gift_card_list(text, text)'::regprocedure) into v_def;
  if position('''workshopType''' in v_def) > 0 then return; end if;
  if position('''lang'', g.lang,' in v_def) = 0 then raise exception 'F40 : admin_gift_card_list diffère de F39 — rien n''est appliqué'; end if;
  execute replace(v_def, '''lang'', g.lang,', '''lang'', g.lang, ''kind'', g.kind, ''workshopType'', g.workshop_type, ''workshopPlaces'', g.workshop_places,');
end $$;

-- ── 6. Grants ───────────────────────────────────────────────────────────
revoke all on function public.gift_card_lookup(text) from public, anon, authenticated;
revoke all on function public.reserve_gift_card(text, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.gift_card_create_manual(text, numeric, text, text, text, text, text, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.gift_card_lookup(text) to service_role;
grant execute on function public.reserve_gift_card(text, uuid, numeric, numeric) to service_role;
grant execute on function public.gift_card_create_manual(text, numeric, text, text, text, text, text, integer, text, text, text, text, integer) to service_role;

commit;

-- Checks (expected: 0 | 1 | 1 | t):
-- select count(*) from public.gift_cards where kind <> 'amount';
-- select count(*) from pg_proc where proname = 'reserve_gift_card';
-- select count(*) from pg_proc where proname = 'gift_card_create_manual';
-- select position('workshopType' in pg_get_functiondef('public.admin_gift_card_list(text, text)'::regprocedure)) > 0;
