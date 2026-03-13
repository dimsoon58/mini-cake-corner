
-- Add order_number column
ALTER TABLE public.orders ADD COLUMN order_number text UNIQUE;

-- Drop old trigger and function
DROP TRIGGER IF EXISTS set_invoice_number ON public.orders;
DROP FUNCTION IF EXISTS public.generate_invoice_number();

-- Create new function that generates both order_number and invoice_number
CREATE OR REPLACE FUNCTION public.generate_order_and_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  date_part text;
  daily_count integer;
  seq_str text;
BEGIN
  -- Format YYMMDD from order_date (the cake/pickup date)
  date_part := to_char(NEW.order_date, 'YYMMDD');
  
  -- Count existing orders for the same cake date
  SELECT COUNT(*) INTO daily_count
  FROM public.orders
  WHERE order_date = NEW.order_date
    AND order_number IS NOT NULL;
  
  seq_str := lpad((daily_count + 1)::text, 2, '0');
  
  -- Handle collision
  WHILE EXISTS (
    SELECT 1 FROM public.orders 
    WHERE order_number = 'ORD-' || date_part || seq_str
  ) LOOP
    daily_count := daily_count + 1;
    seq_str := lpad((daily_count + 1)::text, 2, '0');
  END LOOP;
  
  NEW.order_number := 'ORD-' || date_part || seq_str;
  NEW.invoice_number := 'INV-' || date_part || seq_str;
  RETURN NEW;
END;
$$;

-- Create trigger
CREATE TRIGGER set_order_and_invoice_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_order_and_invoice_number();
