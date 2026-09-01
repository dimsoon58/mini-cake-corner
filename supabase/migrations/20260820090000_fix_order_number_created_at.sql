-- Correction de la génération de order_number / invoice_number
--
-- A exécuter dans Supabase : Dashboard > SQL Editor > New query > coller > Run.
-- Le script peut être relancé sans risque (idempotent).
--
-- Deux problèmes corrigés :
--
-- 1. Le format ORD-YYMMDDNN doit être basé sur la date de création réelle
--    de la commande (created_at), jamais sur la date de retrait/livraison
--    (pickup_delivery_datetime). Le trigger actuel utilise
--    pickup_delivery_datetime, ce qui fait qu'une commande passée aujourd'hui
--    pour un retrait la semaine prochaine reçoit le numéro de la semaine
--    prochaine — pas celui du jour où elle a réellement été passée.
--
-- 2. Le compteur journalier doit être atomique. La version actuelle fait un
--    COUNT(*) puis une boucle de relance en cas de collision : deux commandes
--    passées presque simultanément peuvent calculer le même compte avant que
--    l'une des deux ne soit validée, et la seconde échoue alors sur la
--    contrainte UNIQUE au lieu de recevoir le numéro suivant proprement.
--    On remplace ça par une table de compteurs par jour, incrémentée via
--    INSERT ... ON CONFLICT DO UPDATE ... RETURNING : Postgres pose un
--    verrou de ligne sur le compteur du jour, donc les commandes concurrentes
--    sont sérialisées et ne peuvent jamais recevoir le même numéro.

-- 1. Table de compteurs : une ligne par jour calendaire (Europe/Zurich),
--    uniquement modifiée par le trigger ci-dessous (SECURITY DEFINER) —
--    aucun accès direct nécessaire côté client.
CREATE TABLE IF NOT EXISTS public.order_number_counters (
  day date PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

ALTER TABLE public.order_number_counters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_number_counters'
      AND policyname = 'Service role only'
  ) THEN
    CREATE POLICY "Service role only" ON public.order_number_counters
      FOR ALL USING (false);
  END IF;
END $$;

-- 2. On amorce le compteur de chaque jour avec le nombre de commandes déjà
--    créées ce jour-là (Europe/Zurich), pour que la prochaine commande du
--    jour continue la séquence au bon endroit au lieu de repartir à 01.
--    Les order_number déjà attribués aux commandes existantes ne sont PAS
--    modifiés (ils circulent déjà dans les emails, factures, Notion, Make).
INSERT INTO public.order_number_counters (day, last_seq)
SELECT (created_at AT TIME ZONE 'Europe/Zurich')::date AS day, count(*)
FROM public.orders
GROUP BY 1
ON CONFLICT (day) DO UPDATE
  SET last_seq = GREATEST(public.order_number_counters.last_seq, excluded.last_seq);

-- 3. Nouvelle version de la fonction EXISTANTE sur la base live
--    (public.set_order_and_invoice_number — vérifié directement sur la
--    base de production par l'utilisateur). On la remplace en place avec
--    CREATE OR REPLACE : même nom, même signature, donc le trigger existant
--    qui l'appelle continue de pointer dessus sans rien recréer.
CREATE OR REPLACE FUNCTION public.set_order_and_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  local_day date;
  date_part text;
  seq_int integer;
  seq_str text;
BEGIN
  -- La valeur par défaut de created_at (now()) est déjà résolue avant que ce
  -- trigger BEFORE INSERT ne s'exécute, donc NEW.created_at est toujours
  -- renseigné ici même si le client ne l'envoie jamais explicitement.
  local_day := (NEW.created_at AT TIME ZONE 'Europe/Zurich')::date;
  date_part := to_char(local_day, 'YYMMDD');

  INSERT INTO public.order_number_counters (day, last_seq)
  VALUES (local_day, 1)
  ON CONFLICT (day) DO UPDATE
    SET last_seq = public.order_number_counters.last_seq + 1
  RETURNING last_seq INTO seq_int;

  seq_str := lpad(seq_int::text, 2, '0');

  NEW.order_number := 'ORD-' || date_part || seq_str;
  NEW.invoice_number := 'INV-' || date_part || seq_str;
  RETURN NEW;
END;
$$;

-- 4. Trigger EXISTANT sur la base live : set_order_and_invoice_number_before_insert.
--    On le recrée explicitement (DROP + CREATE, sous le même nom) pour rester
--    idempotent si ce script est relancé, sans jamais laisser deux triggers
--    BEFORE INSERT actifs sur public.orders — aucun autre nom de trigger ou
--    de fonction n'est touché par ce script.
DROP TRIGGER IF EXISTS set_order_and_invoice_number_before_insert ON public.orders;

CREATE TRIGGER set_order_and_invoice_number_before_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_order_and_invoice_number();
