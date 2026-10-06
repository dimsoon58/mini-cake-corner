-- F24 — retour en arrière, ÉTAPE 3a (écriture) : cas C dont la fiche Notion EXISTE.
-- 7323863 cherche la fiche par l'ID Supabase (orders.id) et la met à jour (module 49) : ce
-- chemin n'est sûr QUE si la fiche existe. Pour une fiche absente, utiliser l'étape 3b.
-- Remplacer la liste ci-dessous par les ID (colonne `id` de l'étape 1) dont la fiche a été
-- trouvée dans Notion par l'ID Supabase. Liste laissée telle quelle : aucune ligne modifiée.
with liste(id) as (values
  ('00000000-0000-0000-0000-000000000000'::uuid)
)
update public.orders o
   set side_effects_done_at = null
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
