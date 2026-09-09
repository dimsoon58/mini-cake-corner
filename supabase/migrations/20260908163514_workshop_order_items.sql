-- workshop columns on order_items + relax two orders columns.
--
-- ALREADY APPLIED IN PRODUCTION (migration version 20260908163514). This file
-- exists only for migration-history parity — do NOT re-run it (all statements
-- are IF NOT EXISTS / idempotent anyway).
--
-- No cake column is overloaded: a workshop row keeps size / shape / flavors /
-- design / candles etc. NULL/empty and only fills the workshop_* columns.
--
-- The trigger trg_sync_pickup_delivery_date and its function
-- sync_pickup_delivery_date() are NOT touched. That function already guards
-- `IF NEW.pickup_delivery_datetime IS NOT NULL`, so a NULL value is safe.

-- ── order_items: explicit workshop fields (all nullable, no default) ──────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS workshop_type         text,
  ADD COLUMN IF NOT EXISTS workshop_session_id   text,
  ADD COLUMN IF NOT EXISTS workshop_date         date,
  ADD COLUMN IF NOT EXISTS workshop_time         text,
  ADD COLUMN IF NOT EXISTS workshop_participants integer,
  ADD COLUMN IF NOT EXISTS workshop_unit_price   numeric;

COMMENT ON COLUMN public.order_items.workshop_type IS
  'Workshop line only: ''signature'' | ''paint''. NULL for every other product.';
COMMENT ON COLUMN public.order_items.workshop_participants IS
  'Workshop line only: number of participants (total = workshop_unit_price * this).';

-- ── orders: a workshop-only order has no pickup/delivery ─────────────────────
-- pickup_delivery_datetime is a phased-out compatibility column with no
-- remaining reader in the app.
ALTER TABLE public.orders ALTER COLUMN pickup_delivery_datetime DROP NOT NULL;

-- delivery_method is NULL for a workshop-only order (no fake "pickup").
-- Physical orders keep 'pickup' / 'delivery' exactly as before.
ALTER TABLE public.orders ALTER COLUMN delivery_method DROP NOT NULL;
