-- F24 — retour en arrière, ÉTAPE 3 (écriture) : cas C, envoyées avant la coupure sans
-- confirmation Notion. La reprise ne leur renvoie JAMAIS le premier envoi : seulement la
-- réparation 7323863 (orderId + jeton ; le scénario relit la commande dans Supabase).
-- Uniquement si l'étape 1, relancée après le vidage de la file de 7026183, en liste encore,
-- ET si l'une des deux conditions est remplie :
--   • il est vérifié dans Make que 7323863 met à jour la fiche Notion existante sans en créer
--     une seconde ;
--   • chaque commande listée a été cherchée dans Notion par son numéro et en est absente.
update public.orders o
   set side_effects_done_at = null
 where o.finalized_at is not null
   and o.order_failure_reason is null
   and o.make_notified_at is null
   and o.make_webhook_dispatched_at is not null
   and o.notion_sync_status is distinct from 'synced'
   and o.side_effects_done_at >= (select max(a.created_at) from public.app_settings_audit a
                                  where a.key = 'notion_sync_enabled' and a.after = 'false'::jsonb)
   and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop');
