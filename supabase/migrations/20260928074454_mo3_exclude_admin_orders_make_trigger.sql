-- MO3 — Keep Admin manual orders out of the payment_status → Make webhook
-- (scenario 7028025 "Integration Webhooks, Notion") during V1.
--
-- Admin orders have no Notion page in V1. The scenario already ignores
-- 'paid', but continues for other statuses (e.g. 'refunded') and looks up a
-- Notion page by supabase_id. This adds ONE condition to the trigger:
-- NEW.created_via IS DISTINCT FROM 'admin'. Every other order (website,
-- legacy Make/Notion manual orders — created_via NULL) fires exactly as
-- before.
--
-- The Make function notify_make_order_payment_status_change() is NOT
-- modified. The trigger is rebuilt from its own live definition
-- (pg_get_triggerdef), keeping its timing, events, columns and any existing
-- WHEN condition — only the created_via condition is added. Temporary: to
-- be re-evaluated when the Admin → Make → Notion flow is enabled (undo =
-- recreate the trigger from its step-0 definition).
--
-- Re-runnable: does nothing if the condition is already present.

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_triggerdef(t.oid)
    into v_def
  from pg_trigger t
  where t.tgrelid = 'public.orders'::regclass
    and t.tgname = 'make_order_payment_status_change'
    and not t.tgisinternal;

  if v_def is null then
    raise exception 'Trigger make_order_payment_status_change not found on public.orders';
  end if;

  if v_def ilike '%created_via%' then
    raise notice 'make_order_payment_status_change already excludes Admin orders — nothing to do';
    return;
  end if;

  if v_def ~* ' WHEN \(' then
    -- Existing WHEN (…): keep it, AND the new condition.
    v_new := regexp_replace(
      v_def,
      ' WHEN \((.*)\) EXECUTE ',
      ' WHEN ((\1) AND (new.created_via IS DISTINCT FROM ''admin'')) EXECUTE ',
      'i'
    );
  else
    v_new := regexp_replace(
      v_def,
      ' EXECUTE ',
      ' WHEN (new.created_via IS DISTINCT FROM ''admin'') EXECUTE ',
      'i'
    );
  end if;

  if v_new = v_def or v_new not ilike '%created_via%' then
    raise exception 'Could not rewrite trigger definition safely: %', v_def;
  end if;

  execute 'drop trigger make_order_payment_status_change on public.orders';
  execute v_new;

  raise notice 'make_order_payment_status_change recreated as: %', v_new;
end $$;
