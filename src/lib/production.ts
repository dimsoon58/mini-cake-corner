// Génoises de production : bases et catégories (taille + forme), partagées
// par la page Production et la case « Fait » (lien stock ↔ production).
export type SpongeBase = "vanilla" | "chocolate" | "red_velvet" | "vanilla_gf" | "chocolate_gf" | "red_velvet_gf";
export type Category = "bento_round" | "bento_heart" | "medium_round" | "medium_heart" | "large_round" | "large_heart" | "rectangle" | "dot_cake";

export const BASE_LABELS: Record<SpongeBase, { en: string; fr: string }> = {
  vanilla: { en: "Vanilla", fr: "Vanille" },
  chocolate: { en: "Chocolate", fr: "Chocolat" },
  red_velvet: { en: "Red Velvet", fr: "Red Velvet" },
  vanilla_gf: { en: "Vanilla GF", fr: "Vanille sans gluten" },
  chocolate_gf: { en: "Chocolate GF", fr: "Chocolat sans gluten" },
  red_velvet_gf: { en: "Red Velvet GF", fr: "Red Velvet sans gluten" },
};

export const CATEGORY_ORDER: Category[] = ["bento_round", "bento_heart", "medium_round", "medium_heart", "large_round", "large_heart", "rectangle", "dot_cake"];
export const CATEGORY_LABELS: Record<Category, { en: string; fr: string }> = {
  bento_round: { en: "Round Bento", fr: "Bento rond" },
  bento_heart: { en: "Heart Bento", fr: "Bento cœur" },
  medium_round: { en: "Round Medium", fr: "Medium rond" },
  medium_heart: { en: "Heart Medium", fr: "Medium cœur" },
  large_round: { en: "Round Large", fr: "Large rond" },
  large_heart: { en: "Heart Large", fr: "Large cœur" },
  rectangle: { en: "Rectangle", fr: "Rectangle" },
  dot_cake: { en: "Dot Cake", fr: "Dot Cake" },
};

export interface StockUnits { base: SpongeBase; category: Category; units: number }

/** « Medium rond vanille » / « Dot Cake chocolat (pièces) ». */
export const genoiseLabel = (u: { base: SpongeBase; category: Category }, lang: "en" | "fr") =>
  `${CATEGORY_LABELS[u.category]?.[lang] ?? u.category} ${(BASE_LABELS[u.base]?.[lang] ?? u.base).toLowerCase()}${u.category === "dot_cake" ? (lang === "fr" ? " (pièces)" : " (pieces)") : ""}`;

// Garnitures (page Production et fiche de mise en place des étiquettes).
export const INGREDIENT_LABELS: Record<string, { en: string; fr: string }> = {
  raspberry: { en: "Raspberry", fr: "Framboise" },
  ganache: { en: "Chocolate ganache", fr: "Ganache chocolat" },
  salted_caramel: { en: "Salted butter caramel", fr: "Caramel beurre salé" },
  lemon: { en: "Lemon", fr: "Citron" },
  coffee: { en: "Coffee", fr: "Café" },
  praline: { en: "Praline", fr: "Praliné" },
  pistachio: { en: "Pistachio", fr: "Pistache" },
  passion_fruit: { en: "Passion fruit", fr: "Fruit de la passion" },
  orange_blossom: { en: "Orange blossom", fr: "Fleur d'oranger" },
  cream_cheese: { en: "Cream cheese", fr: "Cream cheese" },
};
