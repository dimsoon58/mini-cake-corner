-- Multi-date fulfillment finalisation: customer-facing pages (MyOrders.tsx,
-- and get-order-detail for AdminOrder.tsx) need to read order_fulfillments
-- to show each product's own pickup/delivery date once an order genuinely
-- spans more than one.
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo.
--
-- SAME GAP CLASS as order_items (20260912110000_order_items_customer_
-- select_policy.sql): order_fulfillments has no RLS policy documented
-- anywhere in this repo's migration history — it was created directly in
-- the Supabase dashboard (same as several other objects this session), and
-- until now nothing customer-facing ever needed to read it (Make/Notion
-- read it via service_role, which bypasses RLS entirely — this migration
-- changes nothing about that). Without this, MyOrders.tsx's embedded
-- `order_fulfillments(...)` select would silently come back empty for every
-- customer, exactly like the order_items bug fixed by the sibling
-- migration — and get-order-detail already reads via service_role, so it is
-- unaffected either way, but this policy is added for consistency and for
-- any future customer-facing surface that queries this table directly.
--
-- Scope, deliberately narrow: SELECT only, only for `authenticated`, only
-- for order_fulfillments whose parent order belongs to the requesting user.
-- Never grants INSERT/UPDATE/DELETE — those stay service_role-only, done
-- exclusively by create-postfinance-payment/confirm-postfinance-payment.

alter table public.order_fulfillments enable row level security;

drop policy if exists "Customers can view their own order fulfillments" on public.order_fulfillments;

create policy "Customers can view their own order fulfillments"
on public.order_fulfillments
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_fulfillments.order_id
      and o.customer_id = auth.uid()
  )
);
