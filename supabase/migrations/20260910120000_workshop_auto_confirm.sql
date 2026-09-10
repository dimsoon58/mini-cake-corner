-- Public workshop auto-confirmation
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only.
--
-- A "public workshop" order = a checkout order whose ONLY items are
-- product = 'workshop' (a published session from public.workshop_sessions with
-- a date / time / price / capacity). It needs NO manual Accepter / Refuser:
--   seats available -> payment authorised -> claim_workshop_reservations_batch
--   secures the seats (row-locked, transactional) -> the payment is captured
--   -> reservations set to 'confirmed' -> order_validation = 'approved'
--   -> the customer gets a "booking confirmed" e-mail.
--
-- This ONLY changes workshop-only orders. Cake orders, mixed orders (cake +
-- workshop), quote requests and manual orders keep the existing
-- Accepter / Refuser flow untouched.
--
--   orders.workshop_confirmed_at       set once the auto-confirmation has fully
--                                      succeeded (PostFinance captured +
--                                      reservations 'confirmed' +
--                                      order_validation 'approved'). NULL => the
--                                      side-effect sweep retries it. Only ever
--                                      set for workshop-only orders.
--   orders.workshop_capture_started_at short lease taken JUST BEFORE the
--                                      PostFinance capture so two concurrent
--                                      auto-confirm passes can never both call
--                                      complete-online. Recoverable after 2 min
--                                      (a crashed capture re-reads the real PF
--                                      state on retry and finishes idempotently).

alter table public.orders
  add column if not exists workshop_confirmed_at      timestamptz,
  add column if not exists workshop_capture_started_at timestamptz;

comment on column public.orders.workshop_confirmed_at is
  'Public workshop-only order auto-confirmed (payment captured + reservations confirmed + order_validation approved). NULL for every cake / mixed / manual order.';
comment on column public.orders.workshop_capture_started_at is
  'Lease guarding the auto-confirmation PostFinance capture against concurrent retries. Recoverable after 2 minutes.';

-- Atomic capture lease for the auto-confirmation (double-capture guard).
-- Returns TRUE to exactly one caller; a lease older than 2 minutes without the
-- order becoming confirmed is recoverable.
create or replace function public.claim_workshop_capture(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.orders o
     set workshop_capture_started_at = now()
   where o.id = p_order_id
     and o.workshop_confirmed_at is null
     and (
       o.workshop_capture_started_at is null
       or o.workshop_capture_started_at < now() - interval '2 minutes'
     )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.claim_workshop_capture(uuid) is
  'Atomic lease taken just before the auto-confirmation PostFinance capture. TRUE to exactly one concurrent caller; recoverable after 2 minutes.';

revoke all on function public.claim_workshop_capture(uuid) from public, anon, authenticated;
grant execute on function public.claim_workshop_capture(uuid) to service_role;

-- Backfill: any historical workshop-only order that an admin already approved
-- was, in effect, auto-confirmed — stamp it so the sweep never touches it and
-- send-workshop-email reads the "confirmed" wording on a re-open.
update public.orders o
set workshop_confirmed_at = coalesce(o.workshop_confirmed_at, o.finalized_at, o.paid_at, o.created_at)
where o.workshop_confirmed_at is null
  and o.order_validation = 'approved'
  and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product = 'workshop')
  and not exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop');
