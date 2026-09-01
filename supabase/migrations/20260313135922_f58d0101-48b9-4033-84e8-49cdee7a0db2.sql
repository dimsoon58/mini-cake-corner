
-- Add invoice_number column
ALTER TABLE public.orders ADD COLUMN invoice_number text UNIQUE;

-- Create function to generate invoice number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  date_prefix text;
  daily_count integer;
  new_invoice text;
BEGIN
  -- Format: INV-YYMMDD##
  date_prefix := 'INV-' || to_char(NEW.order_date, 'YYMMDD');
  
  -- Count existing orders for the same order_date
  SELECT COUNT(*) INTO daily_count
  FROM public.orders
  WHERE order_date = NEW.order_date
    AND invoice_number IS NOT NULL;
  
  new_invoice := date_prefix || lpad((daily_count + 1)::text, 2, '0');
  
  -- Handle unlikely collision
  WHILE EXISTS (SELECT 1 FROM public.orders WHERE invoice_number = new_invoice) LOOP
    daily_count := daily_count + 1;
    new_invoice := date_prefix || lpad((daily_count + 1)::text, 2, '0');
  END LOOP;
  
  NEW.invoice_number := new_invoice;
  RETURN NEW;
END;
$$;

-- Create trigger
CREATE TRIGGER set_invoice_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_invoice_number();
