
-- Create the order-images storage bucket (public for email/calendar access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('order-images', 'order-images', true);

-- Allow anyone to upload to the order-images bucket
CREATE POLICY "Anyone can upload order images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'order-images');

-- Allow public read access
CREATE POLICY "Public read access for order images"
ON storage.objects FOR SELECT
USING (bucket_id = 'order-images');
