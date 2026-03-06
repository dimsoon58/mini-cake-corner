-- Add top-level image URL array on orders for reliable reuse in emails/calendar
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

-- Backfill from existing order_details_json.items[].imageUrls when available
UPDATE public.orders
SET image_urls = COALESCE(
  (
    SELECT array_agg(url)
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(item->'imageUrls', '[]'::jsonb)) AS url
      FROM jsonb_array_elements(COALESCE(order_details_json->'items', '[]'::jsonb)) AS item
    ) urls
  ),
  '{}'::text[]
)
WHERE COALESCE(array_length(image_urls, 1), 0) = 0;