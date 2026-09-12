-- Customer account: old orders placed as a guest (before the customer ever
-- created an account, or from a device where they weren't logged in) are
-- stored with orders.customer_id = NULL — set only from the authenticated
-- session at checkout time (create-postfinance-payment: "Never trust
-- customer_id from the client payload — always stamp it server-side from
-- the authenticated user"). Nothing anywhere in the codebase ever links
-- such an order back to an account created afterwards with the same
-- e-mail, so it can never appear in MyOrders.tsx (which filters strictly
-- on customer_id = auth.uid()) even though the order genuinely belongs to
-- that person.
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo.
--
-- Fix: a narrow, self-service claim RPC, called from MyOrders.tsx right
-- before it loads the order list. Deliberately minimal and safe:
--   * only ever UPDATEs a row whose customer_id IS NULL — an order already
--     linked to any account (this one or someone else's) is never touched;
--   * no parameter of any kind: identity is auth.uid() alone, and the
--     e-mail to match is read straight from auth.users for that id —
--     never auth.jwt(), never a client-supplied value — requiring
--     email_confirmed_at IS NOT NULL and is_anonymous = false, so an
--     unverified address or an anonymous session can never claim an order;
--   * SECURITY DEFINER (bypasses RLS deliberately, the same way every other
--     privileged RPC in this repo does) with search_path pinned to ''
--     (every identifier below is schema-qualified accordingly) and an
--     itemized REVOKE/GRANT so only an authenticated user can call it,
--     never anon.
create or replace function public.claim_guest_orders_for_current_user()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_user_id is null then
    return 0;
  end if;

  select lower(btrim(u.email))
  into v_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false;

  if v_email is null or v_email = '' then
    return 0;
  end if;

  update public.orders o
  set customer_id = v_user_id
  where o.customer_id is null
    and lower(btrim(o.email)) = v_email;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.claim_guest_orders_for_current_user() from public;
revoke execute on function public.claim_guest_orders_for_current_user() from anon;
grant execute on function public.claim_guest_orders_for_current_user() to authenticated;
