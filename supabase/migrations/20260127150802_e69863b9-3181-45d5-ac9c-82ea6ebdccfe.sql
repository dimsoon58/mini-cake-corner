-- Create table to track orders per day
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_date DATE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    delivery_option TEXT NOT NULL,
    delivery_address TEXT,
    newsletter_subscription BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read order counts (for calendar availability check)
CREATE POLICY "Anyone can count orders per date"
ON public.orders
FOR SELECT
USING (true);

-- Allow anyone to insert orders (public checkout)
CREATE POLICY "Anyone can create orders"
ON public.orders
FOR INSERT
WITH CHECK (true);

-- Create index for fast date lookups
CREATE INDEX idx_orders_order_date ON public.orders(order_date);

-- Create a function to get order count for a specific date
CREATE OR REPLACE FUNCTION public.get_order_count_for_date(target_date DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.orders
  WHERE order_date = target_date
$$;

-- Create a function to get all dates that are fully booked (5+ orders)
CREATE OR REPLACE FUNCTION public.get_fully_booked_dates()
RETURNS TABLE(booked_date DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT order_date
  FROM public.orders
  GROUP BY order_date
  HAVING COUNT(*) >= 5
$$;