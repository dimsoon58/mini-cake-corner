-- Welcome-discount reservation reconciliation (2026-09-14).
--
-- Bug this fixes: claim_welcome_discount() is the ONLY thing that can ever
-- release a stale welcome_discount_reserved_order_id (its own 30-minute
-- self-heal branch), but it is only ever called from
-- create-postfinance-payment when the client submits useWelcomeDiscount:
-- true — which requires the "Use my welcome offer" checkbox to be visible,
-- which requires canUseWelcomeDiscountNow to already be true client-side,
-- which is exactly what a stale reservation blocks. A customer whose
-- voucher was NEVER used (welcome_discount_used_at stays null) could
-- therefore lose access to the checkbox indefinitely after one abandoned
-- checkout attempt, with literally no way to trigger the self-heal again.
--
-- Fix: a read-only-except-for-releasing reconciliation RPC the customer's
-- own browser can call directly (SECURITY DEFINER + auth.uid() scoped, same
-- pattern as get_reward_reservation_for_order), wired into Checkout.tsx so
-- it runs once per stale-looking reservation and refreshes the profile
-- before the checkbox is ever shown. It NEVER claims/reserves anything
-- (that stays exclusively claim_welcome_discount's job, exclusively at
-- actual "Proceed to Payment" time) and NEVER touches
-- welcome_discount_used_at — it can only null out a reservation already
-- proven dead by the exact same rule claim_welcome_discount already uses.

-- ── 1. Shared staleness predicate, extracted from claim_welcome_discount's
--    own self-heal branch so both functions can never drift apart. Same 30
--    minute window, same "no durable orders row, no live pending_payments
--    row" check, unchanged.
--    INTERNAL HELPER ONLY: revoked from every client-facing role below —
--    only other SECURITY DEFINER functions owned by this same role (which
--    keep their owner's privileges for the whole call, ownership included)
--    may call it.
create or replace function public.is_welcome_discount_reservation_stale(
  p_reserved_order_id uuid,
  p_reserved_at timestamptz
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    p_reserved_order_id is not null
    and p_reserved_at is not null
    and p_reserved_at < now() - interval '30 minutes'
    and not exists (
      select 1 from public.orders where id = p_reserved_order_id
    )
    and not exists (
      select 1 from public.pending_payments
      where order_id = p_reserved_order_id
        and created_at > now() - interval '30 minutes'
    );
$$;

revoke all on function public.is_welcome_discount_reservation_stale(uuid, timestamptz) from public;
revoke all on function public.is_welcome_discount_reservation_stale(uuid, timestamptz) from anon;
revoke all on function public.is_welcome_discount_reservation_stale(uuid, timestamptz) from authenticated;

-- ── 2. claim_welcome_discount — refactored to delegate its self-heal
--    branch to the shared predicate above. Functionally IDENTICAL to the
--    version in 20260825135608_welcome_discount_voucher.sql: same three
--    claimable cases (available, already mine, provably stale), same
--    SECURITY DEFINER + service_role-only grants. Pure dedup, no behaviour
--    change — this is the function create-postfinance-payment already
--    calls and must keep calling exactly the same way.
create or replace function public.claim_welcome_discount(p_customer_id uuid, p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count integer := 0;
begin
  update public.profiles
  set welcome_discount_reserved_order_id = p_order_id,
      welcome_discount_reserved_at = now()
  where id = p_customer_id
    and welcome_discount_available = true
    and welcome_discount_used_at is null
    and (welcome_discount_expires_at is null or welcome_discount_expires_at > now())
    and (
      welcome_discount_reserved_order_id is null
      or welcome_discount_reserved_order_id = p_order_id
      or public.is_welcome_discount_reservation_stale(
            welcome_discount_reserved_order_id, welcome_discount_reserved_at
          )
    );

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

revoke all on function public.claim_welcome_discount(uuid, uuid) from public;
revoke all on function public.claim_welcome_discount(uuid, uuid) from anon;
revoke all on function public.claim_welcome_discount(uuid, uuid) from authenticated;
grant execute on function public.claim_welcome_discount(uuid, uuid) to service_role;

-- ── 3. reconcile_welcome_discount_reservation — the new, customer-callable
--    entry point. Read-only except for releasing a PROVEN-stale
--    reservation; never claims, never reserves, never touches
--    welcome_discount_used_at. Takes no order_id — it only ever acts on the
--    CALLING customer's own current reservation, whatever it is.
--
-- Security: SECURITY DEFINER + auth.uid() read INTERNALLY (never accepts a
-- customer id from the caller, so a customer can only ever reconcile their
-- own row) — same pattern as get_reward_reservation_for_order. Granted to
-- authenticated (unlike claim_welcome_discount, this one the customer's own
-- browser calls directly with their own session — no Edge Function needed).
create or replace function public.reconcile_welcome_discount_reservation()
returns table (
  welcome_discount_used_at timestamptz,
  welcome_discount_reserved_order_id uuid,
  welcome_discount_reserved_at timestamptz,
  welcome_discount_available boolean,
  welcome_discount_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null then
    return; -- no session -> nothing to reconcile, empty result
  end if;

  -- Release ONLY when the reservation is provably dead (same predicate
  -- claim_welcome_discount's self-heal branch already uses): older than 30
  -- minutes AND no durable orders row AND no pending_payments row younger
  -- than 30 minutes for that reserved order id. A reservation matching a
  -- still-live attempt, or already at rest (null), is left untouched.
  -- welcome_discount_used_at is never referenced here — a spent voucher
  -- stays spent regardless of what this does.
  update public.profiles p
  set welcome_discount_reserved_order_id = null,
      welcome_discount_reserved_at = null
  where p.id = v_customer_id
    and public.is_welcome_discount_reservation_stale(
          p.welcome_discount_reserved_order_id, p.welcome_discount_reserved_at
        );

  return query
    select
      p.welcome_discount_used_at,
      p.welcome_discount_reserved_order_id,
      p.welcome_discount_reserved_at,
      p.welcome_discount_available,
      p.welcome_discount_expires_at
    from public.profiles p
    where p.id = v_customer_id;
end;
$$;

revoke all on function public.reconcile_welcome_discount_reservation() from public;
revoke all on function public.reconcile_welcome_discount_reservation() from anon;
grant execute on function public.reconcile_welcome_discount_reservation() to authenticated;
