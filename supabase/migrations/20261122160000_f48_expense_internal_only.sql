-- F48 — Compta : case « Interne uniquement » sur une dépense.
--
-- Une dépense cochée compte normalement chez nous (résultat du mois,
-- décompte K4, partage Mel / Eli) mais n'est JAMAIS transmise au fiduciaire :
-- ni ligne, ni total, ni justificatif dans le dossier fiduciaire (le filtre
-- est appliqué à l'export). Le changement est historisé (updated_by/_at et
-- audit existant de la table expenses).
--
-- Additive, relançable. Aucune autre donnée modifiée.

begin;

alter table public.expenses add column if not exists internal_only boolean not null default false;

create or replace function public.compta_set_internal_only(p_id uuid, p_flag boolean, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.expenses set internal_only = coalesce(p_flag, false), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null and internal_only is distinct from coalesce(p_flag, false);
end;
$$;

revoke all on function public.compta_set_internal_only(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.compta_set_internal_only(uuid, boolean, text) to service_role;

commit;
