// Collection de Noël 2026 : prix serveur des gâteaux et des bûches.
//
// MUST stay in sync with src/data/christmas.ts (same ids, same prices, same
// supplements). Deno functions can't import from src/, so this is a copy by
// necessity, like INSPIRATION_DESIGNS in pricing.ts.
//
// - Gâteau de Noël : product "bento_cake", design "noel-<id>", forme ronde,
//   ni extras ni bougies. Prix = prix de Noël de la taille + supplément du
//   goût (« Nos classiques » = supplément habituel du site, « Christmas
//   Edition » = cakeFlavourSurcharge ci-dessous).
// - Bûche : product "christmas_log", size "buche", design "buche-<id>".
//   Prix = CHRISTMAS_LOG_PRICE + supplément du goût. Jamais de réduction
//   (bienvenue, influenceur, partenaire) : décision de Mel du 07.11.2026.

export type ChristmasSize = "bento" | "retro" | "medium" | "large";

export const CHRISTMAS_CAKE_PRICES: Record<string, Partial<Record<ChristmasSize, number>>> = {
  "noel-sapin": { retro: 60, medium: 140, large: 230 },
  "noel-cirque": { retro: 55, medium: 110, large: 190 },
  "noel-royal": { retro: 55, medium: 105, large: 185 },
  "noel-gui": { retro: 55, medium: 105, large: 185 },
  "noel-pere-noel": { bento: 50, medium: 100, large: 190 },
  "noel-monsieur-neige": { bento: 50, medium: 100, large: 190 },
  "noel-beau-sapin": { bento: 45, medium: 90, large: 175 },
  "noel-rodolphe": { bento: 45, medium: 90, large: 175 },
};

// Noms (français) affichés dans les emails, la facture et l'admin.
export const CHRISTMAS_DESIGN_NAMES: Record<string, string> = {
  "noel-sapin": "Le Sapin de Noël",
  "noel-cirque": "Le Cirque de Noël",
  "noel-royal": "Noël Royal",
  "noel-gui": "Gui de Noël",
  "noel-pere-noel": "Le Père Noël",
  "noel-monsieur-neige": "Monsieur Neige",
  "noel-beau-sapin": "Mon beau sapin",
  "noel-rodolphe": "Rodolphe",
  "buche-grinch": "Grinch",
  "buche-jardin-hiver": "Le Jardin d’Hiver",
  "buche-casse-noisette": "Casse-Noisette",
  "buche-etoile-noel": "Étoile de Noël",
};

export const CHRISTMAS_LOG_IDS = ["buche-grinch", "buche-jardin-hiver", "buche-casse-noisette", "buche-etoile-noel"];
export const CHRISTMAS_LOG_PRICE = 65;
export const CHRISTMAS_LOG_SIZE = "buche";

// Christmas Edition : supplément de la bûche par garniture (CHF).
export const LOG_FLAVOUR_SURCHARGES: Record<string, number> = {
  "noel-vanille-classique": 0,
  "noel-chocolat-classique": 0,
  "noel-vanille-framboise": 4,
  "noel-caramel-cacahuetes": 4,
  "noel-pomme-cannelle": 4,
  "noel-pate-a-tartiner": 4,
  "noel-marron": 4,
  "noel-chocolat": 4,
  "noel-mangue-passion": 6,
  "noel-lemon-curd": 4,
};

// Nom (français) enregistré dans order_items.flavors pour un goût
// Christmas Edition — le même que celui écrit par la page Noël.
export const CHRISTMAS_FLAVOUR_NAMES: Record<string, string> = {
  "noel-vanille-classique": "Vanille classique",
  "noel-chocolat-classique": "Chocolat classique",
  "noel-vanille-framboise": "Vanille framboise",
  "noel-caramel-cacahuetes": "Caramel cacahuètes",
  "noel-pomme-cannelle": "Pomme cannelle",
  "noel-pate-a-tartiner": "Pâte à tartiner",
  "noel-marron": "Marron",
  "noel-chocolat": "Chocolate Lovers",
  "noel-mangue-passion": "Mangue passion",
  "noel-lemon-curd": "Lemon curd",
};

// « Nos classiques » proposés sur les gâteaux de Noël (sans la pistache).
export const CHRISTMAS_CLASSIC_FLAVOURS = [
  "vanilla", "red-velvet", "chocolate", "chocolate-lovers", "chocolate-lover-berrylicious",
  "dark-berrylicious", "white-berrylicious", "salted-caramel", "lemon-curd", "tiramisu",
  "praline", "passion-fruit", "vanilla-gf", "red-velvet-gf", "chocolate-gf",
];

// Dernière date de retrait / livraison possible pour un article de Noël
// (Mel, 07.11.2026 : jusqu'au 28.12 ; la fermeture commence le 29.12).
export const CHRISTMAS_LAST_DATE = "2026-12-28";

export function isChristmasCakeDesign(design: string | null | undefined): boolean {
  return !!design && Object.prototype.hasOwnProperty.call(CHRISTMAS_CAKE_PRICES, design);
}

export function isChristmasItem(item: { product?: string | null; design?: string | null }): boolean {
  return item.product === "christmas_log" || (item.product === "bento_cake" && isChristmasCakeDesign(item.design));
}

// Gâteau, Christmas Edition : bento / retro = la moitié du supplément de la
// bûche, medium = le même, large = bento + medium. undefined = goût inconnu.
export function christmasEditionCakeSurcharge(flavourId: string, size: ChristmasSize): number | undefined {
  const log = LOG_FLAVOUR_SURCHARGES[flavourId];
  if (log === undefined) return undefined;
  const small = log / 2;
  if (size === "bento" || size === "retro") return small;
  if (size === "medium") return log;
  return small + log;
}
