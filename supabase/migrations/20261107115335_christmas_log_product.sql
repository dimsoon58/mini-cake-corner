-- Noël 2026 : nouveau produit « Bûche de Noël » (order_items.product).
-- Les gâteaux de Noël restent des bento_cake (design noel-<id>) : rien à
-- changer pour eux. Additif, sans effet sur les commandes existantes.
ALTER TYPE public.product_type ADD VALUE IF NOT EXISTS 'christmas_log';
