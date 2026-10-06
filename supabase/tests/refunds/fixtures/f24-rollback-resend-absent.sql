-- F24 — retour en arrière, ÉTAPE 3b (écriture) : cas C dont la fiche Notion est ABSENTE.
-- La réparation 7323863 n'est pas fiable sans fiche (identifiant vide au module 49, avant le
-- branchement « fiche absente » du module 4) : on rend la commande à l'état « jamais envoyée »
-- pour que la reprise fasse le PREMIER envoi, une seule fois, vers 7026183 (chemin normal).
-- Préalables :
--   • 7026183 : file d'attente vide ET aucune exécution incomplète qui concerne ces commandes
--     (sinon un rejeu ultérieur créerait une seconde fiche) ;
--   • chaque commande cherchée dans Notion par son ID Supabase, et absente ;
--   • étape 1 relancée juste avant.
-- Remplacer la liste ci-dessous par ces ID. Liste laissée telle quelle : aucune ligne modifiée.
-- Aucun e-mail renvoyé (marqueurs conservés), aucune facture refaite.
with liste(id) as (values
  ('00000000-0000-0000-0000-000000000000'::uuid)
)
update public.orders o
   set side_effects_done_at = null,
       make_webhook_dispatched_at = null,
       notion_sync_status = 'pending',
       notion_sync_last_error = null
  from liste
 where o.id = liste.id
   and o.finalized_at is not null
   and o.order_failure_reason is null
   and o.make_notified_at is null
   and o.make_webhook_dispatched_at is not null
   and o.notion_sync_status is distinct from 'synced'
   and o.side_effects_done_at >= (select max(a.created_at) from public.app_settings_audit a
                                  where a.key = 'notion_sync_enabled' and a.after = 'false'::jsonb)
   and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop')
returning o.id, o.order_number;
