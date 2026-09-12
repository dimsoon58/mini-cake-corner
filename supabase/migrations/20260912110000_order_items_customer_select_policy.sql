-- Fix: customer order history (MyOrders.tsx) shows item details for SOME
-- orders and none for others, even when order_items rows genuinely exist
-- (confirmed directly in Supabase by the user for ORD-26082602: exactly 1
-- order_items row exists, yet the customer-facing query returns none).
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo.
--
-- ROOT CAUSE: MyOrders.tsx reads via PostgREST's embedded-resource syntax —
--   supabase.from("orders").select("..., order_items(...)").eq("customer_id", user.id)
-- `orders` itself is correctly scoped by its own RLS policy (customer_id =
-- auth.uid()) — that part already works, which is why order_number/date/
-- total_amount always render correctly. But an EMBEDDED table is
-- independently subject to ITS OWN RLS: PostgREST evaluates the
-- authenticated role's policies on `order_items` separately, and unless a
-- policy explicitly grants that read, the embed silently comes back as an
-- empty array — no error, nothing in the network tab to notice, just a
-- quietly empty order_items[] for that order. Grepping this entire repo's
-- migrations for any `order_items` RLS policy returns nothing — meaning, if
-- one exists in production at all, it was created directly in the Supabase
-- dashboard, undocumented, and either missing entirely or not shaped to
-- match this query. This migration adds the ONE policy actually needed,
-- versioned, so it no longer depends on dashboard state no one here can see
-- or reason about.
--
-- Scope, deliberately narrow: SELECT only, only for `authenticated`, only
-- for order_items whose parent order belongs to the requesting user. Never
-- broadens who can read someone else's order_items, never grants INSERT/
-- UPDATE/DELETE (those stay service_role-only, done exclusively by the Edge
-- Functions that already own order creation/mutation — this policy changes
-- nothing about who can WRITE this table).

alter table public.order_items enable row level security;

drop policy if exists "Customers can view their own order items" on public.order_items;

create policy "Customers can view their own order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.customer_id = auth.uid()
  )
);
