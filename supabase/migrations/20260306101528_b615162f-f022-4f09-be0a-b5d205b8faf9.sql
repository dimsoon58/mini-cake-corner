
CREATE POLICY "Anyone can update orders" ON public.orders
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
