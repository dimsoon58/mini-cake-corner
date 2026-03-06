CREATE OR REPLACE FUNCTION public.get_order_count_for_date(target_date date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::INTEGER
  FROM public.orders
  WHERE order_date = target_date
    AND status = 'approved'
$function$;

CREATE OR REPLACE FUNCTION public.get_fully_booked_dates()
 RETURNS TABLE(booked_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT order_date
  FROM public.orders
  WHERE status = 'approved'
  GROUP BY order_date
  HAVING COUNT(*) >= 5
$function$;