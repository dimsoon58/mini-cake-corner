-- PostFinance Checkout : colonnes de paiement + verrouillage des commandes
--
-- A executer dans Supabase : Dashboard > SQL Editor > New query > coller > Run.
-- Le script peut etre relance sans risque.

-- 1. Suivi du paiement, separe du statut metier (pending / approved / rejected)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS postfinance_transaction_id text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

COMMENT ON COLUMN public.orders.payment_status IS
  'pending | authorized | paid | failed | voided | refunded — ecrit uniquement par le webhook PostFinance';

CREATE INDEX IF NOT EXISTS orders_postfinance_transaction_id_idx
  ON public.orders (postfinance_transaction_id);

-- 2. Securite : plus personne ne peut modifier une commande depuis le navigateur.
--    C'est ce qui permettait, aujourd'hui, de passer une commande en "payee"
--    depuis la console du navigateur.
--    Les fonctions Supabase utilisent la cle service_role, qui ignore les
--    regles RLS : create-payment, le webhook et manage-order continuent donc
--    de fonctionner normalement.
DROP POLICY IF EXISTS "Anyone can update orders" ON public.orders;

-- La creation de commande depuis le site reste autorisee.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND policyname = 'Anyone can create orders'
  ) THEN
    CREATE POLICY "Anyone can create orders" ON public.orders
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Note : la regle de LECTURE reste ouverte pour l'instant, la page
-- d'administration des commandes s'en sert. A resserrer dans un second temps.
