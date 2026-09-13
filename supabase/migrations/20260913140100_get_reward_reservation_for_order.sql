-- get_reward_reservation_for_order(p_order_id uuid): read-only lookup of the
-- CALLING customer's own reward reservation for ONE specific order.
--
-- NOT YET APPLIED.
--
-- Display-only helper for Checkout.tsx's "resume this exact payment attempt"
-- flow. Deliberately narrow: takes the order_id the customer's own browser
-- already knows (persisted in sessionStorage at checkout time, never guessed
-- or defaulted), and returns a row ONLY when it belongs to the CALLING
-- authenticated customer — never "the" reservation of a customer picked
-- arbitrarily (reward_reservations is unique on order_id only, a customer
-- can hold several 'reserved' rows across different orders at once — see
-- list_active_reward_reservations() for the aggregate view used elsewhere).
-- Never used to decide whether to resume/release a payment attempt — that
-- decision lives entirely in create-postfinance-payment (real PostFinance
-- verification, cart-fingerprint comparison), server-authoritative. This
-- function only answers "how much, so the UI can show it."
--
-- Security:
--   * SECURITY DEFINER + SET search_path = public (consistent with every
--     other reward RPC in this codebase).
--   * auth.uid() is read INTERNALLY — never accepts a customer id from the
--     caller. A null auth.uid() (no session) returns no rows.
--   * order_id = p_order_id AND customer_id = auth.uid() — both required,
--     so a leaked/guessed order_id from another customer's checkout can
--     never surface their reservation.
--   * REVOKE from PUBLIC/anon, GRANT to authenticated only.

create or replace function public.get_reward_reservation_for_order(p_order_id uuid)
returns table (
  order_id   uuid,
  amount     numeric,
  status     text,
  expires_at timestamptz
)
language sql
security definer
set search_path to 'public'
stable
as $function$
  select rr.order_id, rr.amount, rr.status, rr.expires_at
  from public.reward_reservations rr
  where auth.uid() is not null
    and rr.order_id = p_order_id
    and rr.customer_id = auth.uid()
    and rr.status = 'reserved';
$function$;

revoke all on function public.get_reward_reservation_for_order(uuid) from public;
revoke all on function public.get_reward_reservation_for_order(uuid) from anon;
grant execute on function public.get_reward_reservation_for_order(uuid) to authenticated;
