-- F24 — retour en arrière, ÉTAPE 2 (écriture) : remettre dans la reprise (toutes les 15 min)
-- les cas A (jamais envoyées → premier envoi) et B (déjà confirmées → aucun envoi).
-- Aucun e-mail renvoyé (marqueurs admin_notified_at / customer_email_sent_at conservés),
-- aucune facture refaite. Seulement APRÈS notion_sync_enabled = true et l'étape 1.
-- Les cas C ne sont PAS touchés ici (étape 3).
update public.orders o
   set side_effects_done_at = null
 where o.finalized_at is not null
   and o.order_failure_reason is null
   and o.make_notified_at is null
   and (o.notion_sync_status = 'synced' or o.make_webhook_dispatched_at is null)
   and o.side_effects_done_at >= (select max(a.created_at) from public.app_settings_audit a
                                  where a.key = 'notion_sync_enabled' and a.after = 'false'::jsonb)
   and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop');
