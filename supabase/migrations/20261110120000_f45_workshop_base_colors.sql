-- F45 (10.11.2026) — Workshop Pochage : chaque participant choisit sa génoise
-- (vanille / chocolat, déjà dans workshop_sponge_choices) ET la couleur de
-- base de son gâteau. Avant, la couleur était envoyée à la place de la génoise
-- et rejetée par le serveur : ni goût ni couleur n'étaient enregistrés.
-- Une couleur par participant (id du catalogue, comme order_items.base_color),
-- même ordre que workshop_sponge_choices. NULL pour les autres workshops et
-- pour tous les autres produits. Additif, sans effet sur l'existant.
alter table public.order_items add column if not exists workshop_base_colors text[];

comment on column public.order_items.workshop_base_colors is
  'F45 — Workshop Pochage: base colour id per participant (catalogue ids, same order as workshop_sponge_choices). Set by create-postfinance-payment / manage-manual-order only.';

-- Contrôle (attendu : 1 ligne, ARRAY) :
-- select data_type from information_schema.columns where table_name = 'order_items' and column_name = 'workshop_base_colors';
