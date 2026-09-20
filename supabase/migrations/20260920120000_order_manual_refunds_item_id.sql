-- order_manual_refunds.order_item_id — lets the admin tie a manual refund to
-- one specific cake, instead of it always applying to the whole order.
--
-- Why: order_manual_refunds was order-scoped only. For an order with several
-- cakes on different pickup/delivery dates, a refund recorded for one
-- cancelled cake had no way to say WHICH one — /admin/dashboard (scoped by
-- pickup/delivery date) could then subtract it from the wrong month's
-- revenue, or from every month the order touches.
--
-- Same shape as order_refunds.order_item_id (20260917184500_order_refunds.sql):
-- nullable, never guessed from an amount match. NULL means "this refund
-- applies to the order as a whole" (e.g. a genuine whole-order goodwill
-- gesture) and list-orders-by-date keeps attributing it to every entry of
-- the order, deduped once — exactly today's behaviour. Set means it's
-- attributed directly to that one order_item's own date.

alter table public.order_manual_refunds
  add column if not exists order_item_id uuid references public.order_items(id);

comment on column public.order_manual_refunds.order_item_id is
  'Nullable. Set when the admin ties this refund to one specific order_item (e.g. one cancelled cake on a multi-date order) — list-orders-by-date then attributes it to that item''s own pickup/delivery date instead of the whole order. NULL means order-wide (applied once to the order, same as before this column existed).';
