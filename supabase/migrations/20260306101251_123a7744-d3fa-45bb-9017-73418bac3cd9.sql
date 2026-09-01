
ALTER TABLE public.orders 
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ADD COLUMN stripe_payment_intent_id text,
  ADD COLUMN stripe_session_id text,
  ADD COLUMN order_details_json jsonb;
