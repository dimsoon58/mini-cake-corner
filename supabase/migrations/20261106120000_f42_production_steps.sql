-- F42 (06.11.2026) — étapes de production par gâteau.
--
-- La case unique « Fait » devient 5 étapes : Déco, Texte, Extra, Emballé,
-- Donné. Chaque étape cochée garde qui et quand, dans
-- order_items.production_steps :
--   { "deco": {"at": "...", "by": "..."}, "emballe": {...}, ... }
--
-- production_status reste la seule valeur lue partout ailleurs (Production,
-- tableau de bord, planning, exports). Il est déduit des étapes :
--   Donné              → picked_up (retrait) / delivered (livraison)
--   Emballé            → ready_for_pickup   (compte comme « fait »)
--   Déco/Texte/Extra   → in_progress        (pas encore « fait »)
--   aucune             → to_assign
--
-- Stock (F15) : cocher Déco retire les génoises (production_mark_done),
-- décocher Déco propose de les remettre (production_mark_undone).
-- Ordre libre. Les gâteaux déjà « Fait » avant F42 (étapes vides) sont lus
-- comme Déco + Texte + Extra + Emballé cochés ; ceux déjà remis (delivered /
-- picked_up) comme tout coché. Aucune donnée existante n'est réécrite.
--
-- Ne touche ni aux paiements, ni aux montants, ni aux commandes.

begin;

alter table public.order_items
  add column if not exists production_steps jsonb not null default '{}'::jsonb;

-- Étapes lues pour un article (avec la lecture des statuts d'avant F42).
create or replace function public.production_effective_steps(p_steps jsonb, p_status text)
returns jsonb language sql immutable set search_path to '' as $$
  select case
    when coalesce(p_steps, '{}'::jsonb) <> '{}'::jsonb then p_steps
    when p_status in ('completed', 'ready_for_pickup') then
      jsonb_build_object('deco', '{"legacy": true}'::jsonb, 'texte', '{"legacy": true}'::jsonb,
                         'extra', '{"legacy": true}'::jsonb, 'emballe', '{"legacy": true}'::jsonb)
    when p_status in ('delivered', 'picked_up') then
      jsonb_build_object('deco', '{"legacy": true}'::jsonb, 'texte', '{"legacy": true}'::jsonb,
                         'extra', '{"legacy": true}'::jsonb, 'emballe', '{"legacy": true}'::jsonb,
                         'donne', '{"legacy": true}'::jsonb)
    else '{}'::jsonb
  end;
$$;

-- Statut déduit des étapes.
create or replace function public.production_status_from_steps(p_steps jsonb, p_delivery boolean)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_steps ? 'donne' then case when p_delivery then 'delivered' else 'picked_up' end
    when p_steps ? 'emballe' then 'ready_for_pickup'
    when p_steps ?| array['deco', 'texte', 'extra'] then 'in_progress'
    else 'to_assign'
  end;
$$;

-- Coche / décoche une étape. Pour Déco, p_mode ('stock' / 'fresh'),
-- p_needs, p_unknown (cocher) et p_return, p_note (décocher) passent au
-- lien stock de F15. Rejouable : cocher une étape déjà cochée ne change rien.
create or replace function public.production_set_step(
  p_item uuid, p_step text, p_on boolean, p_by text, p_delivery boolean,
  p_mode text default 'fresh', p_needs jsonb default '[]'::jsonb, p_unknown integer default 0,
  p_return jsonb default '[]'::jsonb, p_note text default null)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_item public.order_items;
  v_steps jsonb;
  v_status text;
  v_stock jsonb := null;
begin
  if p_step not in ('deco', 'texte', 'extra', 'emballe', 'donne') then
    raise exception 'Étape invalide' using errcode = 'P0001';
  end if;
  select * into v_item from public.order_items where id = p_item for update;
  if not found then raise exception 'Article introuvable' using errcode = 'P0002'; end if;
  if v_item.product = 'workshop' then raise exception 'Les workshops n''ont pas d''étapes' using errcode = 'P0001'; end if;
  if v_item.production_status = 'cancelled' then raise exception 'Ce gâteau est annulé' using errcode = 'P0001'; end if;

  v_steps := public.production_effective_steps(v_item.production_steps, v_item.production_status::text);

  if p_on = (v_steps ? p_step) then
    -- Déjà dans cet état : rien à faire.
    return jsonb_build_object('steps', v_steps, 'productionStatus', v_item.production_status::text, 'replayed', true);
  end if;

  if p_step = 'deco' then
    if p_on then
      v_stock := public.production_mark_done(p_item, coalesce(p_mode, 'fresh'), p_needs, p_unknown, p_by);
    else
      v_stock := public.production_mark_undone(p_item, p_return, p_note, p_by);
    end if;
  end if;

  if p_on then
    v_steps := v_steps || jsonb_build_object(p_step, jsonb_build_object('at', now(), 'by', p_by));
  else
    v_steps := v_steps - p_step;
  end if;
  v_status := public.production_status_from_steps(v_steps, coalesce(p_delivery, false));

  update public.order_items
     set production_steps = v_steps, production_status = v_status::public.production_status
   where id = p_item and production_status <> 'cancelled';

  return jsonb_build_object('steps', v_steps, 'productionStatus', v_status, 'stock', v_stock, 'replayed', false);
end $$;

revoke all on function public.production_set_step(uuid, text, boolean, text, boolean, text, jsonb, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.production_set_step(uuid, text, boolean, text, boolean, text, jsonb, integer, jsonb, text) to service_role;

commit;
