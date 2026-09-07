-- Delivery by driving distance — ADDITIVE ONLY.
--
-- A executer dans Supabase : Dashboard > SQL Editor > New query > coller >
-- Run. Le script peut etre relance sans risque (IF NOT EXISTS partout).
--
-- Aucune colonne existante n'est supprimee ni renommee. On continue de
-- reutiliser : delivery_address, delivery_zone, delivery_fee, delivery_method.
-- On ajoute uniquement les 5 colonnes ci-dessous, remplies par
-- create-postfinance-payment a partir de l'adresse Google selectionnee.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_postal_code text,
  ADD COLUMN IF NOT EXISTS delivery_city        text,
  ADD COLUMN IF NOT EXISTS delivery_latitude    numeric,
  ADD COLUMN IF NOT EXISTS delivery_longitude   numeric,
  ADD COLUMN IF NOT EXISTS delivery_distance_km numeric;

COMMENT ON COLUMN public.orders.delivery_postal_code IS
  'Code postal de l''adresse de livraison (Google Places). NULL pour un retrait.';
COMMENT ON COLUMN public.orders.delivery_city IS
  'Ville de l''adresse de livraison (Google Places). NULL pour un retrait.';
COMMENT ON COLUMN public.orders.delivery_latitude IS
  'Latitude de l''adresse de livraison (Google Places). NULL pour un retrait.';
COMMENT ON COLUMN public.orders.delivery_longitude IS
  'Longitude de l''adresse de livraison (Google Places). NULL pour un retrait.';
COMMENT ON COLUMN public.orders.delivery_distance_km IS
  'Distance routiere voiture cuisine -> client (Google Routes, TRAFFIC_UNAWARE), '
  'non arrondie avant application de la grille tarifaire. NULL pour un retrait.';
