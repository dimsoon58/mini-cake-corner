-- Physical-product order calendar: express surcharge column.
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only.
--
-- A pickup/delivery date 3 calendar days or less after the order date
-- (Europe/Zurich) is an EXPRESS order: +10% of the physical-product amount
-- (delivery fees and workshop lines excluded). create-postfinance-payment
-- computes this server-side from pickup_delivery_date and stores the amount
-- here so emails / invoice / admin can show it. Whether an order is express is
-- always re-derivable from order_date vs pickup_delivery_date; this column is
-- the resolved money amount only.

alter table public.orders
  add column if not exists express_surcharge_amount numeric(10,2) not null default 0;

comment on column public.orders.express_surcharge_amount is
  'Express surcharge charged on this order (10% of the physical-product amount, delivery + workshops excluded). 0 when the pickup/delivery date is 4+ calendar days out.';
