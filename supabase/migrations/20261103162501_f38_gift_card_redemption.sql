-- F38 (03.11.2026) — Bons cadeaux, step 2: using a voucher in the cart.
--
-- A voucher is a means of payment, applied LAST at checkout (after the
-- welcome / partner discount and the cagnotte, express surcharge and
-- delivery included). Same lifecycle as the cagnotte (reward_reservations):
--   reserve  — create-postfinance-payment, before the PostFinance page:
--              the amount leaves the voucher balance at once (no double use);
--   consume  — the order is accepted and paid (trigger below);
--   release  — the payment fails / is abandoned / the order is refused or
--              cancelled before acceptance: the amount goes back on the voucher;
--   recredit — an accepted order is fully refunded or cancelled: the voucher
--              part goes back on the voucher (cash part refunded as usual).
-- Partial cancellations (one item, some workshop seats) do not re-credit the
-- voucher automatically yet: the administrator does it by hand (step 3).
-- Everything here is service_role only.
begin;

-- ── 1. Columns ──────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists gift_card_amount numeric(10,2) not null default 0 check (gift_card_amount >= 0),
  add column if not exists gift_card_code text;
alter table public.order_items
  add column if not exists gift_card_amount numeric(10,2) not null default 0 check (gift_card_amount >= 0);

comment on column public.orders.gift_card_amount is
  'F38 — part of the order paid with a gift voucher (not charged to the card). total_amount is what the card pays.';
comment on column public.order_items.gift_card_amount is
  'F38 — voucher share allocated to this line (workshop lines last). total is never reduced; used for refund math.';

-- ── 2. Reservations ─────────────────────────────────────────────────────
create table if not exists public.gift_card_reservations (
  id                uuid primary key default gen_random_uuid(),
  gift_card_id      uuid not null references public.gift_cards(id),
  order_id          uuid not null unique,
  amount            numeric(10,2) not null check (amount > 0),
  recredited_amount numeric(10,2) not null default 0 check (recredited_amount >= 0 and recredited_amount <= amount),
  status            text not null default 'reserved' check (status in ('reserved', 'consumed', 'released', 'recredited')),
  created_at        timestamptz not null default now(),
  consumed_at       timestamptz,
  released_at       timestamptz,
  recredited_at     timestamptz
);
create index if not exists gift_card_reservations_card_idx on public.gift_card_reservations (gift_card_id, status);

alter table public.gift_card_reservations enable row level security;
revoke all on table public.gift_card_reservations from public, anon, authenticated;
grant all on table public.gift_card_reservations to service_role;

-- ── 3. Lookup (cart check, no reservation) ──────────────────────────────
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
  -- Balance as the next checkout will see it: stale reservations (no order,
  -- checkout gone or older than 24 h) count as available again.
  v_available := v_card.balance + coalesce((
    select sum(r.amount) from public.gift_card_reservations r
     where r.gift_card_id = v_card.id and r.status = 'reserved'
       and not exists (select 1 from public.orders o where o.id = r.order_id)
       and (not exists (select 1 from public.pending_payments pp where pp.order_id = r.order_id)
            or r.created_at < now() - interval '24 hours')), 0);
  v_available := least(v_available, v_card.initial_amount);
  if v_available <= 0 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  return jsonb_build_object('ok', true, 'code', v_card.code, 'balance', v_available, 'expiresAt', v_card.expires_at);
end;
$$;

-- ── 4. Reserve ──────────────────────────────────────────────────────────
-- Locks the voucher row: two checkouts with the same code never both take
-- the same balance. Idempotent per order (same order + same voucher → the
-- existing reservation, re-capped). A stale reservation of THIS voucher
-- (no order, and its checkout gone or older than 24 h) is given back first.
create or replace function public.reserve_gift_card(p_code text, p_order_id uuid, p_max_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_card   public.gift_cards%rowtype;
  v_res    public.gift_card_reservations%rowtype;
  v_amount numeric(10,2);
  v_stale  record;
begin
  if p_order_id is null then raise exception 'gift_card: order id required' using errcode = 'P0001'; end if;
  select * into v_card from public.gift_cards where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or v_card.status not in ('active', 'disabled') then raise exception 'gift_card_unknown' using errcode = 'P0001'; end if;
  if v_card.status = 'disabled' then raise exception 'gift_card_disabled' using errcode = 'P0001'; end if;
  if v_card.expires_at <= now() then raise exception 'gift_card_expired' using errcode = 'P0001'; end if;

  -- Stale reservations of this voucher → back on the balance.
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

  -- An earlier attempt of the SAME order (retry): give it back, then re-take.
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

  v_amount := round(least(v_card.balance, greatest(coalesce(p_max_amount, 0), 0)), 2);
  if v_amount <= 0 then
    update public.gift_cards set balance = v_card.balance, updated_at = now() where id = v_card.id;
    if v_card.balance <= 0 then raise exception 'gift_card_empty' using errcode = 'P0001'; end if;
    return jsonb_build_object('amount', 0, 'giftCardId', v_card.id, 'code', v_card.code, 'balanceAfter', v_card.balance);
  end if;

  update public.gift_cards set balance = v_card.balance - v_amount, updated_at = now() where id = v_card.id;
  insert into public.gift_card_reservations (gift_card_id, order_id, amount) values (v_card.id, p_order_id, v_amount);
  return jsonb_build_object('amount', v_amount, 'giftCardId', v_card.id, 'code', v_card.code, 'balanceAfter', v_card.balance - v_amount);
end;
$$;

-- ── 5. Release / consume / recredit (all idempotent) ────────────────────
create or replace function public.release_gift_card_reservation(p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res public.gift_card_reservations%rowtype;
begin
  select * into v_res from public.gift_card_reservations where order_id = p_order_id and status = 'reserved' for update;
  if not found then return 0; end if;
  update public.gift_cards set balance = least(initial_amount, balance + v_res.amount), updated_at = now() where id = v_res.gift_card_id;
  update public.gift_card_reservations set status = 'released', released_at = now() where id = v_res.id;
  return v_res.amount;
end;
$$;

create or replace function public.consume_gift_card_for_order(p_order_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res public.gift_card_reservations%rowtype;
begin
  select * into v_res from public.gift_card_reservations where order_id = p_order_id and status = 'reserved' for update;
  if not found then return 0; end if;
  update public.gift_card_reservations set status = 'consumed', consumed_at = now() where id = v_res.id;
  return v_res.amount;
end;
$$;

-- p_amount null = everything not yet re-credited.
create or replace function public.recredit_gift_card_for_order(p_order_id uuid, p_amount numeric default null)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res  public.gift_card_reservations%rowtype;
  v_back numeric(10,2);
begin
  select * into v_res from public.gift_card_reservations where order_id = p_order_id and status in ('consumed', 'recredited') for update;
  if not found then return 0; end if;
  v_back := round(least(v_res.amount - v_res.recredited_amount, coalesce(p_amount, v_res.amount)), 2);
  if v_back <= 0 then return 0; end if;
  update public.gift_cards set balance = least(initial_amount, balance + v_back), updated_at = now() where id = v_res.gift_card_id;
  update public.gift_card_reservations
     set recredited_amount = recredited_amount + v_back,
         status = case when recredited_amount + v_back >= amount then 'recredited' else status end,
         recredited_at = now()
   where id = v_res.id;
  return v_back;
end;
$$;

-- ── 6. Order status trigger (same branches as the cagnotte trigger) ─────
create or replace function public.handle_order_gift_card_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.gift_card_amount, 0) <= 0 then return new; end if;

  -- Refused (physical part or whole order) → back on the voucher.
  if (new.physical_validation = 'rejected' and old.physical_validation is distinct from 'rejected')
     or (new.order_validation = 'rejected' and old.order_validation is distinct from 'rejected') then
    perform public.release_gift_card_reservation(new.id);

  -- Fully refunded / cancelled after acceptance → voucher part re-credited
  -- (a reservation still « reserved » is simply released).
  elsif (new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded')
     or (new.order_validation = 'cancelled' and old.order_validation is distinct from 'cancelled') then
    perform public.release_gift_card_reservation(new.id);
    perform public.recredit_gift_card_for_order(new.id, null);

  -- Accepted and paid → consumed.
  elsif new.order_validation = 'approved'
     and new.payment_status = 'paid'
     and coalesce(new.physical_validation, 'not_applicable') <> 'rejected'
     and (old.order_validation is distinct from 'approved' or old.payment_status is distinct from 'paid') then
    perform public.consume_gift_card_for_order(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_gift_card_status_change on public.orders;
create trigger trg_order_gift_card_status_change
  after update of order_validation, payment_status, physical_validation
  on public.orders
  for each row
  execute function public.handle_order_gift_card_status_change();

-- ── 7. Abandoned checkout also gives the voucher back ───────────────────
-- abandon_checkout_reservation (live since 20260914170000) gets one more
-- statement, right after its own release_reward_reservation call. Guarded:
-- the live definition must still contain that call, else nothing changes.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'abandon_checkout_reservation';
  if v_def is null then raise exception 'F38 : abandon_checkout_reservation introuvable — rien n''est appliqué'; end if;
  if position('release_gift_card_reservation' in v_def) > 0 then return; end if;
  if position('perform public.release_reward_reservation(p_order_id);' in v_def) = 0 then
    raise exception 'F38 : abandon_checkout_reservation en production diffère du dépôt — rien n''est appliqué';
  end if;
  execute replace(v_def,
    'perform public.release_reward_reservation(p_order_id);',
    'perform public.release_reward_reservation(p_order_id);' || chr(10) || '  perform public.release_gift_card_reservation(p_order_id);');
end $$;

-- ── 8. Workshop seat cancellation never refunds the voucher share as cash
-- cancel_workshop_seats_atomic (F35 version) also subtracts the line's
-- gift_card_amount from the cash captured. Guarded the same way.
do $$
declare
  v_def text;
  v_old text := '- coalesce((select oi.partner_discount_amount from public.order_items oi where oi.id = v_res.order_item_id), 0), 2);';
  v_new text := '- coalesce((select coalesce(oi.partner_discount_amount, 0) + coalesce(oi.gift_card_amount, 0) from public.order_items oi where oi.id = v_res.order_item_id), 0), 2);';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_workshop_seats_atomic';
  if v_def is null then raise exception 'F38 : cancel_workshop_seats_atomic introuvable — rien n''est appliqué'; end if;
  if position('oi.gift_card_amount' in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then
    raise exception 'F38 : cancel_workshop_seats_atomic en production diffère de F35 — rien n''est appliqué';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ── 9. Grants ───────────────────────────────────────────────────────────
revoke all on function public.gift_card_lookup(text) from public, anon, authenticated;
revoke all on function public.reserve_gift_card(text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.release_gift_card_reservation(uuid) from public, anon, authenticated;
revoke all on function public.consume_gift_card_for_order(uuid) from public, anon, authenticated;
revoke all on function public.recredit_gift_card_for_order(uuid, numeric) from public, anon, authenticated;
revoke all on function public.handle_order_gift_card_status_change() from public, anon, authenticated;
grant execute on function public.gift_card_lookup(text) to service_role;
grant execute on function public.reserve_gift_card(text, uuid, numeric) to service_role;
grant execute on function public.release_gift_card_reservation(uuid) to service_role;
grant execute on function public.consume_gift_card_for_order(uuid) to service_role;
grant execute on function public.recredit_gift_card_for_order(uuid, numeric) to service_role;

commit;

-- Checks (expected: 0 | 2 rows | t | t | t):
-- select count(*) from public.gift_card_reservations;
-- select column_name from information_schema.columns where table_schema = 'public' and column_name = 'gift_card_amount' and table_name in ('orders', 'order_items');
-- select position('release_gift_card_reservation' in pg_get_functiondef('public.abandon_checkout_reservation(uuid, uuid)'::regprocedure)) > 0;
-- select position('oi.gift_card_amount' in pg_get_functiondef('public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean)'::regprocedure)) > 0;
-- select exists (select 1 from pg_trigger where tgname = 'trg_order_gift_card_status_change');
