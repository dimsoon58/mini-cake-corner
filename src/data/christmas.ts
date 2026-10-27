// Collection de Noël 2026 — gâteaux et bûches (page /noel).
//
// Prix = prix final de l'article, quel que soit le parfum (décision du
// 27.10.2026) : pas de supplément de parfum, pas d'extras. Une taille sans
// prix n'est pas proposée pour ce design.
//
// image: null tant que la photo n'est pas fournie — la page affiche un cadre
// vide à la place.
import { allFlavors } from "@/data/customization";

export type ChristmasSize = "bento" | "retro" | "medium" | "large";

export interface ChristmasCake {
  id: string;
  nameFr: string;
  nameEn: string;
  prices: Partial<Record<ChristmasSize, number>>;
  image: string | null;
}

export interface ChristmasLog {
  id: string;
  nameFr: string;
  nameEn: string;
  image: string | null;
}

export interface ChristmasFlavour {
  id: string;
  nameFr: string;
  nameEn: string;
  descriptionFr?: string;
  descriptionEn?: string;
}

export const CHRISTMAS_CAKES: ChristmasCake[] = [
  { id: "noel-pere-noel", nameFr: "Le Père Noël", nameEn: "Santa Claus", prices: { bento: 50, medium: 100, large: 190 }, image: null },
  { id: "noel-monsieur-neige", nameFr: "Monsieur Neige", nameEn: "Mr Snow", prices: { bento: 50, medium: 100, large: 190 }, image: null },
  { id: "noel-rodolphe", nameFr: "Rodolphe", nameEn: "Rudolph", prices: { bento: 45, medium: 90, large: 175 }, image: null },
  { id: "noel-royal", nameFr: "Noël Royal", nameEn: "Royal Christmas", prices: { retro: 55, medium: 105, large: 185 }, image: null },
  { id: "noel-sapin", nameFr: "Le Sapin de Noël", nameEn: "Christmas Tree", prices: { retro: 60, medium: 140, large: 230 }, image: null },
  { id: "noel-cirque", nameFr: "Le Cirque de Noël", nameEn: "Christmas Circus", prices: { retro: 55, medium: 110, large: 190 }, image: null },
  { id: "noel-gui", nameFr: "Gui de Noël", nameEn: "Under the Mistletoe", prices: { retro: 55, medium: 105, large: 185 }, image: null },
];

// Même prix pour toutes les bûches.
export const CHRISTMAS_LOG_PRICE = 65;

export const CHRISTMAS_LOGS: ChristmasLog[] = [
  { id: "buche-casse-noisette", nameFr: "Casse-Noisette", nameEn: "Nutcracker", image: null },
  { id: "buche-jardin-hiver", nameFr: "Le Jardin d’Hiver", nameEn: "Winter Garden", image: null },
  { id: "buche-etoile-noel", nameFr: "Étoile de Noël", nameEn: "Christmas Star", image: null },
];

// Parfums des bûches (liste du 27.10.2026).
export const LOG_FLAVOURS: ChristmasFlavour[] = [
  { id: "noel-vanille-framboise", nameFr: "Vanille framboise", nameEn: "Vanilla Raspberry" },
  { id: "noel-lemon-curd", nameFr: "Lemon curd", nameEn: "Lemon Curd" },
  { id: "noel-pomme-cannelle", nameFr: "Pomme cannelle", nameEn: "Apple Cinnamon" },
  { id: "noel-mangue-passion", nameFr: "Mangue passion vanille", nameEn: "Mango Passion Vanilla" },
  { id: "noel-pate-a-tartiner", nameFr: "Pâte à tartiner", nameEn: "Chocolate Hazelnut Spread" },
  { id: "noel-caramel-cacahuetes", nameFr: "Caramel, cacahuètes concassées", nameEn: "Caramel & Crunchy Peanuts",
    descriptionFr: "Caramel, cacahuètes concassées et snackées", descriptionEn: "Caramel with crushed roasted peanuts" },
  { id: "noel-chocolat", nameFr: "Chocolat", nameEn: "Chocolate",
    descriptionFr: "Génoise chocolat, ganache chocolat et copeaux", descriptionEn: "Chocolate sponge, chocolate ganache and shavings" },
  { id: "noel-marron", nameFr: "Marron", nameEn: "Chestnut" },
  { id: "noel-praline", nameFr: "Praliné", nameEn: "Praline",
    descriptionFr: "Praliné, crêpes dentelles, génoise vanille et crème", descriptionEn: "Praline, crispy lace crêpes, vanilla sponge and cream" },
];

// Parfums de bûche déjà présents (ou presque) dans la carte habituelle :
// pas répétés dans la liste des gâteaux. Lemon curd = Lemon Curd ;
// Vanille framboise ≈ White Berrylicious ; Chocolat ≈ Chocolate Lovers ;
// Praliné ≈ Praline Obsession. À confirmer par Mel.
const LOG_FLAVOURS_ALREADY_IN_CARD = new Set(["noel-lemon-curd", "noel-vanille-framboise", "noel-chocolat", "noel-praline"]);

// Gâteaux de Noël : tous les parfums habituels + les parfums de bûche qui
// n'y sont pas déjà.
export const CAKE_FLAVOURS: ChristmasFlavour[] = [
  ...allFlavors.map((f) => ({ id: f.id, nameFr: f.name, nameEn: f.name, descriptionEn: "description" in f ? String(f.description) : undefined })),
  ...LOG_FLAVOURS.filter((f) => !LOG_FLAVOURS_ALREADY_IN_CARD.has(f.id)),
];

export const CHRISTMAS_SIZE_LABELS: Record<ChristmasSize, { fr: string; en: string; peopleFr: string; peopleEn: string }> = {
  bento: { fr: "Bento", en: "Bento", peopleFr: "jusqu’à 4 personnes", peopleEn: "up to 4 people" },
  retro: { fr: "Retro Box", en: "Retro Box", peopleFr: "jusqu’à 4 personnes", peopleEn: "up to 4 people" },
  medium: { fr: "Medium", en: "Medium", peopleFr: "jusqu’à 8 personnes", peopleEn: "up to 8 people" },
  large: { fr: "Large", en: "Large", peopleFr: "jusqu’à 16 personnes", peopleEn: "up to 16 people" },
};

export const CHRISTMAS_SIZE_ORDER: ChristmasSize[] = ["bento", "retro", "medium", "large"];

/** Lowest price of a cake ("dès CHF 45"). */
export function fromPrice(cake: ChristmasCake): number {
  return Math.min(...Object.values(cake.prices));
}
