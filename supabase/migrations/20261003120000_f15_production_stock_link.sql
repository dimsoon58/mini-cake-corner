-- F15 — Stock relié à la production.
--
-- À appliquer après F14. Ne rejoue aucune migration. Ne touche ni aux
-- paiements, ni aux commandes (sauf order_items.production_status, déjà
-- écrit par update-production-status), ni à Make, ni à Notion.
--
-- Règles (validées le 2026-10-03) :
--   * « Fait » sur un gâteau : « Pris dans le stock » (proposé par défaut,
--     quantité affichée avant confirmation) ou « Préparé frais ». Le retrait
--     se fait par base de génoise × catégorie (taille + forme), pour la
--     quantité ; Dot Cakes en pièces, réparties par base. Un seul retrait par
--     gâteau : une préparation active au plus par article (index unique), le
--     stock et le journal sont modifiés dans la même transaction.
--   * Stock insuffisant : on retire ce qui existe, le reste est « préparé
--     frais » (le stock ne descend jamais sous 0).
--   * Base inconnue : « Fait » autorisé sans retrait, tracé (« Stock non
--     ajusté — base à préciser »).
--   * Décocher « Fait » ne recrée jamais de stock automatiquement ; une
--     restitution (génoises prises dans le stock et pas utilisées) peut être
--     enregistrée à ce moment-là, une seule fois, au plus ce qui a été retiré.
--   * Gâteau préparé puis annulé : la préparation reste tracée ; décision
--     explicite « réutilisable » (remise en stock, au plus ce qui a été
--     préparé) ou « perdu », une seule fois.
--   * Aucun retrait rétroactif : les gâteaux déjà « Fait » avant F15 n'ont pas
--     de préparation enregistrée et ne touchent pas au stock.
--   * Toute modification du stock (y compris la saisie manuelle) est inscrite
--     dans le journal production_stock_movements.
--
-- Additive, relançable. Service role uniquement.

begin;

-- ── Journal des mouvements de stock ──────────────────────────────────────
create table if not exists public.production_stock_movements (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  created_by       text,
  sponge_base      text not null,
  product_category text not null,
  delta            integer not null,
  quantity_after   integer not null check (quantity_after >= 0),
  kind             text not null check (kind in ('order_use', 'return_uncheck', 'return_cancelled', 'inventory')),
  preparation_id   uuid,
  order_item_id    uuid references public.order_items(id),
  note             text
);
create index if not exists production_stock_movements_created_idx on public.production_stock_movements (created_at desc);

-- ── Préparations (une par « Fait » ; reste tracée après annulation) ───────
create table if not exists public.production_preparations (
  id              uuid primary key default gen_random_uuid(),
  order_item_id   uuid not null references public.order_items(id),
  order_id        uuid not null references public.orders(id),
  prepared_at     timestamptz not null default now(),
  prepared_by     text,
  mode            text not null check (mode in ('stock', 'fresh')),
  needs           jsonb not null,                 -- [{base, category, units}] génoises nécessaires
  taken           jsonb not null default '[]',    -- [{base, category, units}] retirées du stock
  fresh_units     integer not null default 0,     -- préparées frais (dont stock insuffisant)
  unknown_units   integer not null default 0,     -- base à préciser : stock non ajusté
  undone_at       timestamptz,
  undone_by       text,
  undo_note       text,
  returned        jsonb,                          -- restitution au décochage (une seule fois)
  reuse_decision  text check (reuse_decision in ('reusable', 'lost')),
  reuse_units     jsonb,                          -- remis en stock si réutilisable
  reuse_decided_at timestamptz,
  reuse_decided_by text,
  reuse_note      text
);
create unique index if not exists production_preparations_active_uidx
  on public.production_preparations (order_item_id) where undone_at is null;
create index if not exists production_preparations_order_idx on public.production_preparations (order_id);

-- ── Historique (même journal d'audit que la Compta) ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['production_preparations', 'production_stock_movements'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Aides ────────────────────────────────────────────────────────────────
-- Valide une liste [{base, category, units}] et la regroupe (units > 0).
create or replace function public.production_units_list(p jsonb)
returns table (base text, category text, units integer) language plpgsql immutable set search_path to '' as $$
begin
  if p is null or jsonb_typeof(p) <> 'array' then return; end if;
  return query
    select e ->> 'base', e ->> 'category', sum((e ->> 'units')::integer)::integer
    from jsonb_array_elements(p) e
    where coalesce((e ->> 'units')::integer, 0) > 0
    group by 1, 2;
  if exists (select 1 from jsonb_array_elements(p) e
             where (e ->> 'base') not in ('vanilla', 'chocolate', 'red_velvet', 'vanilla_gf', 'chocolate_gf', 'red_velvet_gf')
                or (e ->> 'category') not in ('bento_round', 'bento_heart', 'medium_round', 'medium_heart', 'large_round', 'large_heart', 'rectangle', 'dot_cake')
                or (e ->> 'units') !~ '^[0-9]+$') then
    raise exception 'Génoise invalide' using errcode = 'P0001';
  end if;
end $$;

-- Ajoute / retire du stock et inscrit le mouvement (ligne verrouillée).
create or replace function public.production_stock_move(
  p_base text, p_category text, p_delta integer, p_kind text, p_by text,
  p_preparation uuid, p_item uuid, p_note text)
returns integer language plpgsql set search_path to '' as $$
declare v_q integer;
begin
  insert into public.production_stock (sponge_base, product_category, quantity, updated_by)
  values (p_base, p_category, 0, p_by)
  on conflict (sponge_base, product_category) do nothing;
  select quantity into v_q from public.production_stock
   where sponge_base = p_base and product_category = p_category for update;
  if v_q + p_delta < 0 then raise exception 'Stock insuffisant' using errcode = 'P0001'; end if;
  update public.production_stock set quantity = v_q + p_delta, updated_at = now(), updated_by = p_by
   where sponge_base = p_base and product_category = p_category;
  insert into public.production_stock_movements (created_by, sponge_base, product_category, delta, quantity_after, kind, preparation_id, order_item_id, note)
  values (p_by, p_base, p_category, p_delta, v_q + p_delta, p_kind, p_preparation, p_item, p_note);
  return v_q + p_delta;
end $$;

-- ── « Fait » ─────────────────────────────────────────────────────────────
-- p_needs : génoises nécessaires (calculées par la fonction Edge à partir du
-- catalogue de production) ; p_unknown : unités dont la base est inconnue.
-- Rejouable : si l'article a déjà une préparation active, rien n'est retiré.
create or replace function public.production_mark_done(
  p_item uuid, p_mode text, p_needs jsonb, p_unknown integer, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_item public.order_items;
  v_prep public.production_preparations;
  v_id uuid := gen_random_uuid();
  v_taken jsonb := '[]'::jsonb;
  v_fresh integer := 0;
  v_avail integer;
  v_take integer;
  r record;
begin
  if p_mode not in ('stock', 'fresh') then raise exception 'Mode invalide' using errcode = 'P0001'; end if;
  select * into v_item from public.order_items where id = p_item for update;
  if not found then raise exception 'Article introuvable' using errcode = 'P0002'; end if;
  if v_item.production_status = 'cancelled' then raise exception 'Ce gâteau est annulé' using errcode = 'P0001'; end if;

  select * into v_prep from public.production_preparations where order_item_id = p_item and undone_at is null;
  if found then
    update public.order_items set production_status = 'completed' where id = p_item and production_status <> 'cancelled';
    return jsonb_build_object('replayed', true, 'preparation', to_jsonb(v_prep));
  end if;

  for r in select * from public.production_units_list(p_needs) loop
    if p_mode = 'stock' then
      select quantity into v_avail from public.production_stock
       where sponge_base = r.base and product_category = r.category for update;
      v_take := least(r.units, coalesce(v_avail, 0));
    else
      v_take := 0;
    end if;
    if v_take > 0 then
      perform public.production_stock_move(r.base, r.category, -v_take, 'order_use', p_by, v_id, p_item, null);
      v_taken := v_taken || jsonb_build_object('base', r.base, 'category', r.category, 'units', v_take);
    end if;
    v_fresh := v_fresh + (r.units - v_take);
  end loop;

  insert into public.production_preparations (id, order_item_id, order_id, prepared_by, mode, needs, taken, fresh_units, unknown_units)
  values (v_id, p_item, v_item.order_id, p_by, p_mode, coalesce(p_needs, '[]'::jsonb), v_taken, v_fresh, greatest(coalesce(p_unknown, 0), 0))
  returning * into v_prep;
  update public.order_items set production_status = 'completed' where id = p_item;
  return jsonb_build_object('replayed', false, 'preparation', to_jsonb(v_prep));
end $$;

-- ── Décocher « Fait » ────────────────────────────────────────────────────
-- Ne recrée jamais de stock automatiquement. p_return : génoises prises
-- dans le stock et réellement récupérables (au plus ce qui a été retiré).
create or replace function public.production_mark_undone(p_item uuid, p_return jsonb, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_item public.order_items;
  v_prep public.production_preparations;
  r record;
  v_taken integer;
  v_any boolean := false;
begin
  select * into v_item from public.order_items where id = p_item for update;
  if not found then raise exception 'Article introuvable' using errcode = 'P0002'; end if;
  if v_item.production_status = 'cancelled' then raise exception 'Ce gâteau est annulé' using errcode = 'P0001'; end if;

  select * into v_prep from public.production_preparations where order_item_id = p_item and undone_at is null for update;
  if not found then
    -- « Fait » d'avant F15 (ou déjà décoché) : statut seulement, aucun stock.
    if exists (select 1 from public.production_units_list(p_return)) then
      raise exception 'Aucune génoise retirée du stock pour ce gâteau' using errcode = 'P0001';
    end if;
    update public.order_items set production_status = 'to_assign' where id = p_item;
    return jsonb_build_object('preparation', null, 'returned', '[]'::jsonb);
  end if;

  for r in select * from public.production_units_list(p_return) loop
    select coalesce(sum((e ->> 'units')::integer), 0) into v_taken
      from jsonb_array_elements(v_prep.taken) e where e ->> 'base' = r.base and e ->> 'category' = r.category;
    if r.units > v_taken then
      raise exception 'On ne peut remettre que ce qui a été retiré du stock (% au plus)', v_taken using errcode = 'P0001';
    end if;
    perform public.production_stock_move(r.base, r.category, r.units, 'return_uncheck', p_by, v_prep.id, p_item, nullif(btrim(coalesce(p_note, '')), ''));
    v_any := true;
  end loop;

  update public.production_preparations
     set undone_at = now(), undone_by = p_by, undo_note = nullif(btrim(coalesce(p_note, '')), ''),
         returned = case when v_any then (select jsonb_agg(jsonb_build_object('base', base, 'category', category, 'units', units)) from public.production_units_list(p_return)) else null end
   where id = v_prep.id
  returning * into v_prep;
  update public.order_items set production_status = 'to_assign' where id = p_item;
  return jsonb_build_object('preparation', to_jsonb(v_prep), 'returned', coalesce(v_prep.returned, '[]'::jsonb));
end $$;

-- ── Gâteau préparé puis annulé ───────────────────────────────────────────
create or replace function public.production_item_cancelled(p_item uuid)
returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from public.order_items i where i.id = p_item and i.production_status = 'cancelled')
      or exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id
                 where i.id = p_item and (o.order_validation in ('cancelled', 'rejected') or o.physical_validation = 'rejected' or o.order_failure_reason is not null))
      or exists (select 1 from public.order_manual_refunds m where m.order_item_id = p_item and m.cancels_item);
$$;

-- À décider : préparations encore actives dont le gâteau a été annulé.
create or replace function public.production_pending_reuse()
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'preparationId', p.id, 'orderItemId', p.order_item_id, 'orderId', p.order_id,
      'orderNumber', o.order_number, 'customerName', trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')),
      'product', i.product, 'size', i.size, 'shape', i.shape,
      'preparedAt', p.prepared_at, 'preparedBy', p.prepared_by, 'needs', p.needs, 'taken', p.taken,
      'freshUnits', p.fresh_units, 'unknownUnits', p.unknown_units
    ) order by p.prepared_at), '[]'::jsonb)
  from public.production_preparations p
  join public.order_items i on i.id = p.order_item_id
  join public.orders o on o.id = p.order_id
  where p.undone_at is null and p.reuse_decision is null and public.production_item_cancelled(p.order_item_id);
$$;

-- Décision « réutilisable » (remise en stock, au plus ce qui a été préparé)
-- ou « perdu ». Une seule fois par préparation.
create or replace function public.production_reuse_decide(p_preparation uuid, p_reusable boolean, p_units jsonb, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_prep public.production_preparations;
  r record;
  v_prepared integer;
  v_units jsonb;
begin
  select * into v_prep from public.production_preparations where id = p_preparation for update;
  if not found then raise exception 'Préparation introuvable' using errcode = 'P0002'; end if;
  if v_prep.reuse_decision is not null then raise exception 'Décision déjà enregistrée' using errcode = 'P0001'; end if;
  if v_prep.undone_at is not null then raise exception 'Ce gâteau n''est plus marqué « Fait »' using errcode = 'P0001'; end if;
  if not public.production_item_cancelled(v_prep.order_item_id) then
    raise exception 'Ce gâteau n''est pas annulé' using errcode = 'P0001';
  end if;
  if p_reusable then
    if not exists (select 1 from public.production_units_list(p_units)) then
      raise exception 'Indiquez combien de génoises sont réutilisables' using errcode = 'P0001';
    end if;
    for r in select * from public.production_units_list(p_units) loop
      select coalesce(sum((e ->> 'units')::integer), 0) into v_prepared
        from jsonb_array_elements(v_prep.needs) e where e ->> 'base' = r.base and e ->> 'category' = r.category;
      if r.units > v_prepared then
        raise exception 'Au plus % génoise(s) préparée(s) pour ce gâteau', v_prepared using errcode = 'P0001';
      end if;
      perform public.production_stock_move(r.base, r.category, r.units, 'return_cancelled', p_by, v_prep.id, v_prep.order_item_id, nullif(btrim(coalesce(p_note, '')), ''));
    end loop;
    select jsonb_agg(jsonb_build_object('base', base, 'category', category, 'units', units)) into v_units from public.production_units_list(p_units);
  end if;
  update public.production_preparations
     set reuse_decision = case when p_reusable then 'reusable' else 'lost' end,
         reuse_units = v_units, reuse_decided_at = now(), reuse_decided_by = p_by,
         reuse_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = v_prep.id
  returning * into v_prep;
  return to_jsonb(v_prep);
end $$;

-- ── Saisie manuelle (inventaire), désormais inscrite au journal ──────────
create or replace function public.production_stock_set(p_base text, p_category text, p_quantity integer, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare v_old integer;
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 9999 then raise exception 'Quantité invalide' using errcode = 'P0001'; end if;
  perform 1 from public.production_units_list(jsonb_build_array(jsonb_build_object('base', p_base, 'category', p_category, 'units', 1)));
  insert into public.production_stock (sponge_base, product_category, quantity, updated_by)
  values (p_base, p_category, 0, p_by)
  on conflict (sponge_base, product_category) do nothing;
  select quantity into v_old from public.production_stock where sponge_base = p_base and product_category = p_category for update;
  if p_quantity <> v_old then
    perform public.production_stock_move(p_base, p_category, p_quantity - v_old, 'inventory', p_by, null, null, nullif(btrim(coalesce(p_note, '')), ''));
  end if;
  return (select to_jsonb(s) from public.production_stock s where sponge_base = p_base and product_category = p_category);
end $$;

-- Derniers mouvements (journal affiché sur la page Production).
create or replace function public.production_recent_movements(p_limit integer)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select m.id, m.created_at, m.created_by, m.sponge_base, m.product_category, m.delta, m.quantity_after, m.kind, m.note,
           o.order_number
    from public.production_stock_movements m
    left join public.order_items i on i.id = m.order_item_id
    left join public.orders o on o.id = i.order_id
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 200)
  ) x;
$$;

-- Préparations actives d'une liste d'articles (pour l'aperçu « Fait »).
create or replace function public.production_active_preparations(p_items uuid[])
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
  from public.production_preparations p
  where p.order_item_id = any(p_items) and p.undone_at is null;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['production_stock_movements', 'production_preparations'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'production_units_list(jsonb)',
    'production_stock_move(text, text, integer, text, text, uuid, uuid, text)',
    'production_mark_done(uuid, text, jsonb, integer, text)',
    'production_mark_undone(uuid, jsonb, text, text)',
    'production_item_cancelled(uuid)',
    'production_pending_reuse()',
    'production_reuse_decide(uuid, boolean, jsonb, text, text)',
    'production_stock_set(text, text, integer, text, text)',
    'production_recent_movements(integer)',
    'production_active_preparations(uuid[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
