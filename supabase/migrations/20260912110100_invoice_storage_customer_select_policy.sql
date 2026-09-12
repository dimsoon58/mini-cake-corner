-- Fix: "Voir la facture" (MyOrders.tsx) — a customer's own createSignedUrl()
-- call against the "invoice" storage bucket has no RLS policy to succeed
-- against (confirmed directly in Supabase by the user: zero SELECT policy
-- exists today on storage.objects for bucket_id = 'invoice').
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo.
--
-- Scope, deliberately narrow and strictly versioned (never a manual
-- dashboard policy):
--   * bucket_id = 'invoice' only — no other bucket is touched.
--   * SELECT only — never INSERT/UPDATE/DELETE (invoices are written
--     exclusively by service-role Edge Functions: manage-order,
--     _shared/order-side-effects.ts — this policy changes nothing about who
--     can WRITE an invoice, only who may read one that already exists).
--   * `to authenticated` only — an anonymous/guest checkout customer has no
--     account to match against, so this policy can never apply to them
--     (consistent with the rest of the app: invoices are only browsable
--     from /account/orders, which already requires being signed in).
--   * Scoped via a join to `public.orders`: the object's storage `name`
--     (invoice bucket paths are flat — "<invoiceNumber>.pdf", see
--     manage-order/index.ts and _shared/order-side-effects.ts, no per-
--     customer folder to match on directly) must equal that ORDER's
--     invoice_path, AND that order's customer_id must be the requesting
--     user. A customer can therefore only ever read the exact PDF tied to
--     one of their own orders — never another customer's invoice, and never
--     the whole bucket made public.

drop policy if exists "Customers can read their own invoice" on storage.objects;

create policy "Customers can read their own invoice"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'invoice'
  and exists (
    select 1
    from public.orders o
    where o.invoice_path = storage.objects.name
      and o.customer_id = auth.uid()
  )
);
