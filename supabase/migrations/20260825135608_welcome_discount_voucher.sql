-- Welcome voucher (-10%) reservation tracking.
-- welcome_discount_available / welcome_discount_used_at / welcome_discount_expires_at
-- already exist on public.profiles from an earlier migration. This adds the
-- two columns needed for the temporary "reserved" state introduced now.
ALTER TABLE public.profiles
  ADD COLUMN welcome_discount_reserved_order_id uuid,
  ADD COLUMN welcome_discount_reserved_at timestamptz;

-- Atomically claims the welcome voucher for one customer + orderId, so two
-- simultaneous checkouts by the same account can never both win it. Must run
-- as SECURITY DEFINER (to update profiles regardless of the caller's RLS)
-- but is locked down to service_role only below — Supabase functions default
-- to PUBLIC-executable, which would otherwise let any authenticated client
-- call this directly.
--
-- Reservation states this function distinguishes:
--   - available: welcome_discount_reserved_order_id IS NULL -> claimable.
--   - reserved by this same order: idempotent retry of the same checkout
--     attempt -> claimable (returns true again, no-op).
--   - reserved by a different order, but abandoned: the reservation is
--     older than 30 minutes AND neither a real orders row nor a live
--     (< 30 min old) pending_payments row exists for that reserved order ->
--     claimable (the previous attempt never reached a durable order).
--   - reserved by a different order, still potentially in progress ->
--     not claimable.
CREATE OR REPLACE FUNCTION public.claim_welcome_discount(p_customer_id uuid, p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_count integer := 0;
BEGIN
  UPDATE public.profiles
  SET welcome_discount_reserved_order_id = p_order_id,
      welcome_discount_reserved_at = now()
  WHERE id = p_customer_id
    AND welcome_discount_available = true
    AND welcome_discount_used_at IS NULL
    AND (welcome_discount_expires_at IS NULL OR welcome_discount_expires_at > now())
    AND (
      welcome_discount_reserved_order_id IS NULL
      OR welcome_discount_reserved_order_id = p_order_id
      OR (
        welcome_discount_reserved_at < now() - interval '30 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM public.orders WHERE id = profiles.welcome_discount_reserved_order_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.pending_payments
          WHERE order_id = profiles.welcome_discount_reserved_order_id
            AND created_at > now() - interval '30 minutes'
        )
      )
    );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

-- Supabase functions default to PUBLIC-executable — explicitly lock this one
-- down to service_role only, since it's a SECURITY DEFINER function that
-- writes to profiles regardless of the caller's own RLS.
REVOKE ALL ON FUNCTION public.claim_welcome_discount(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_welcome_discount(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_welcome_discount(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_discount(uuid, uuid) TO service_role;
