-- Human-readable PostFinance payment reference: PAY-YYMMDDNN.
--
-- Identifies the PAYMENT ATTEMPT / checkout at PostFinance, separate from
-- the existing ORD-YYMMDDNN order number (which continues to identify the
-- final CONFIRMED order, generated exactly as before by
-- set_order_and_invoice_number() / order_number_counters — neither is
-- touched by this migration).
--
-- Generation is DEFERRED to the moment a real PostFinance transaction is
-- actually about to be created (see reserve_payment_reference() below and
-- its call site in create-postfinance-payment/index.ts) — NOT at
-- pending_payments row creation time — so a reward-only checkout
-- (order.total_amount === 0, no real PostFinance transaction ever created)
-- never consumes a reference. Concurrency-safe via the same
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING day-counter pattern
-- already used by order_number_counters (see
-- 20260820090000_fix_order_number_created_at.sql) — a dedicated, separate
-- counter table, never sharing a row/lock with the ORD- sequence.

-- 1. New nullable columns — never backfilled for pre-existing rows.
ALTER TABLE public.pending_payments ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reference text;

-- 2. Dedicated day-counter table, structurally identical to
--    order_number_counters but entirely separate — a payment_reference
--    being minted (or not, e.g. reward-only) can never affect, block on, or
--    skip an ORD- number, and vice versa.
CREATE TABLE IF NOT EXISTS public.payment_reference_counters (
  day date PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

ALTER TABLE public.payment_reference_counters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_reference_counters'
      AND policyname = 'Service role only'
  ) THEN
    CREATE POLICY "Service role only" ON public.payment_reference_counters
      FOR ALL USING (false);
  END IF;
END $$;

-- 3. reserve_payment_reference(order_id) — idempotent, concurrency-safe
--    mint-or-reuse. Row-locks the pending_payments row for this order
--    first (FOR UPDATE): a second concurrent call for the SAME order_id
--    blocks until the first commits, then sees payment_reference already
--    set and simply returns it — never mints a second reference. This is
--    the "never mint another reference because of a race" guarantee,
--    enforced inside the function itself rather than relied upon purely
--    from caller-side control flow (defense in depth alongside the
--    Edge Function's own existing per-orderId serialization).
--
--    Requires an existing pending_payments row for order_id (raises if
--    none exists — the caller, create-postfinance-payment, only ever
--    invokes this after that row is already guaranteed to exist).
CREATE OR REPLACE FUNCTION public.reserve_payment_reference(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_existing text;
  v_local_day date;
  v_date_part text;
  v_seq_int integer;
  v_ref text;
BEGIN
  SELECT payment_reference INTO v_existing
  FROM public.pending_payments
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_payment_reference: no pending_payments row for order %', p_order_id;
  END IF;

  -- Idempotent: already reserved (first call for this order, or we lost a
  -- race and are re-entering after the winner committed) — reuse it,
  -- never mint a second one.
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_local_day := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_date_part := to_char(v_local_day, 'YYMMDD');

  INSERT INTO public.payment_reference_counters (day, last_seq)
  VALUES (v_local_day, 1)
  ON CONFLICT (day) DO UPDATE
    SET last_seq = public.payment_reference_counters.last_seq + 1
  RETURNING last_seq INTO v_seq_int;

  v_ref := 'PAY-' || v_date_part || lpad(v_seq_int::text, 2, '0');

  UPDATE public.pending_payments
  SET payment_reference = v_ref
  WHERE order_id = p_order_id;

  RETURN v_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_payment_reference(uuid) TO service_role;
