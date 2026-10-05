-- F24 — retour en arrière, ÉTAPE 1 (lecture seule) : commandes du site finalisées pendant la
-- coupure Notion, marquées « terminées » sans avoir été envoyées à Notion (gâteau présent).
-- À lancer APRÈS avoir remis notion_sync_enabled = true. Vérifier la liste avant l'étape 2.
select o.id, o.order_number, o.finalized_at, o.side_effects_done_at
from public.orders o
where o.finalized_at is not null
  and o.order_failure_reason is null
  and o.side_effects_done_at is not null
  and o.make_notified_at is null
  and o.finalized_at >= (select max(a.created_at) from public.app_settings_audit a
                         where a.key = 'notion_sync_enabled' and a.after = 'false'::jsonb)
  and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product <> 'workshop')
order by o.finalized_at;
