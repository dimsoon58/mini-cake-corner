-- F24 — retour en arrière, ÉTAPE 1 (lecture seule).
-- Commandes du site (avec gâteau) marquées « terminées » PENDANT la coupure Notion sans
-- confirmation Notion (make_notified_at vide). make_notified_at vide veut dire « Make n'a pas
-- confirmé », PAS « jamais envoyée » : la colonne `cas` sépare les trois situations.
--   A_jamais_envoyee            aucun envoi : la reprise fera le PREMIER envoi (7026183).
--   B_confirmee_entre_temps     Notion a confirmé (synced) : la reprise note seulement la
--                               confirmation, AUCUN envoi.
--   C_envoyee_sans_confirmation envoi fait avant la coupure, sans confirmation : la reprise
--                               n'utilise QUE la réparation (7323863), jamais le premier envoi.
-- À lancer APRÈS la réactivation des scénarios, une fois la file de 7026183 vidée, et APRÈS
-- notion_sync_enabled = true. Relancer juste avant les étapes 2 et 3.
select o.id, o.order_number, o.finalized_at, o.side_effects_done_at,
       o.make_webhook_dispatched_at, o.notion_sync_status,
       case
         when o.notion_sync_status = 'synced' then 'B_confirmee_entre_temps'
         when o.make_webhook_dispatched_at is null then 'A_jamais_envoyee'
         else 'C_envoyee_sans_confirmation'
       end as cas
from public.orders o
where o.finalized_at is not null
  and o.order_failure_reason is null
  and o.make_notified_at is null
  and o.side_effects_done_at >= (select max(a.created_at) from public.app_settings_audit a
                                 where a.key = 'notion_sync_enabled' and a.after = 'false'::jsonb)
  and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop')
order by cas, o.finalized_at;
