// Collection de Noël 2026 — gâteaux et bûches (page /noel).
//
// Prix = prix final de l'article, quel que soit le parfum (décision du
// 27.10.2026) : pas de supplément de parfum, pas d'extras. Une taille sans
// prix n'est pas proposée pour ce design.
//
// image: null tant que la photo n'est pas fournie — la page affiche un cadre
// vide à la place.

import noelPereNoel from "@/assets/noel-pere-noel.jpg";
import noelMonsieurNeige from "@/assets/noel-monsieur-neige.jpg";
import noelRodolphe from "@/assets/noel-rodolphe.jpg";
import noelRoyal from "@/assets/noel-royal.jpg";
import noelBeauSapin from "@/assets/noel-beau-sapin.jpg";
import noelSapin from "@/assets/noel-sapin.jpg";
import noelCirque from "@/assets/noel-cirque.jpg";
import bucheCasseNoisette1 from "@/assets/buche-casse-noisette-1.jpg";
import bucheCasseNoisette2 from "@/assets/buche-casse-noisette-2.jpg";
import bucheJardinHiver1 from "@/assets/buche-jardin-hiver-1.jpg";
import bucheJardinHiver2 from "@/assets/buche-jardin-hiver-2.jpg";
import bucheEtoileNoel1 from "@/assets/buche-etoile-noel-1.jpg";
import bucheEtoileNoel2 from "@/assets/buche-etoile-noel-2.jpg";
import noelGui1 from "@/assets/noel-gui-1.jpg";
import noelGui2 from "@/assets/noel-gui-2.jpg";
import noelGui3 from "@/assets/noel-gui-3.jpg";

export type ChristmasSize = "bento" | "retro" | "medium" | "large";

export interface ChristmasCake {
  id: string;
  nameFr: string;
  nameEn: string;
  prices: Partial<Record<ChristmasSize, number>>;
  image: string | null;
  // Extra photos after `image`, scrolled with the arrows on the card.
  moreImages?: string[];
}

export interface ChristmasLog {
  id: string;
  nameFr: string;
  nameEn: string;
  image: string | null;
  moreImages?: string[];
}

export interface ChristmasFlavour {
  id: string;
  nameFr: string;
  nameEn: string;
  descriptionFr?: string;
  descriptionEn?: string;
}

export const CHRISTMAS_CAKES: ChristmasCake[] = [
  { id: "noel-pere-noel", nameFr: "Le Père Noël", nameEn: "Santa Claus", prices: { bento: 50, medium: 100, large: 190 }, image: noelPereNoel },
  { id: "noel-monsieur-neige", nameFr: "Monsieur Neige", nameEn: "Mr Snow", prices: { bento: 50, medium: 100, large: 190 }, image: noelMonsieurNeige },
  { id: "noel-rodolphe", nameFr: "Rodolphe", nameEn: "Rudolph", prices: { bento: 45, medium: 90, large: 175 }, image: noelRodolphe },
  { id: "noel-royal", nameFr: "Noël Royal", nameEn: "Royal Christmas", prices: { retro: 55, medium: 105, large: 185 }, image: noelRoyal },
  { id: "noel-sapin", nameFr: "Le Sapin de Noël", nameEn: "Christmas Tree", prices: { retro: 60, medium: 140, large: 230 }, image: noelSapin },
  { id: "noel-cirque", nameFr: "Le Cirque de Noël", nameEn: "Christmas Circus", prices: { retro: 55, medium: 110, large: 190 }, image: noelCirque },
  { id: "noel-gui", nameFr: "Gui de Noël", nameEn: "Under the Mistletoe", prices: { retro: 55, medium: 105, large: 185 }, image: noelGui2, moreImages: [noelGui1, noelGui3] },
  { id: "noel-beau-sapin", nameFr: "Mon beau sapin", nameEn: "Little Christmas Tree", prices: { bento: 45, medium: 90, large: 175 }, image: noelBeauSapin },
];

// Même prix pour toutes les bûches.
export const CHRISTMAS_LOG_PRICE = 65;

export const CHRISTMAS_LOGS: ChristmasLog[] = [
  { id: "buche-casse-noisette", nameFr: "Casse-Noisette", nameEn: "Nutcracker", image: bucheCasseNoisette1, moreImages: [bucheCasseNoisette2] },
  { id: "buche-jardin-hiver", nameFr: "Le Jardin d’Hiver", nameEn: "Winter Garden", image: bucheJardinHiver1, moreImages: [bucheJardinHiver2] },
  { id: "buche-etoile-noel", nameFr: "Étoile de Noël", nameEn: "Christmas Star", image: bucheEtoileNoel1, moreImages: [bucheEtoileNoel2] },
];

// Parfums de Noël (garniture), avec une ligne courte qui donne envie.
// Liste et contenu donnés par Mel le 27.10.2026.
export const CHRISTMAS_FLAVOURS: ChristmasFlavour[] = [
  { id: "noel-vanille-framboise", nameFr: "Vanille framboise", nameEn: "Vanilla Raspberry",
    descriptionFr: "Un généreux coulis de framboise.", descriptionEn: "A generous raspberry coulis." },
  { id: "noel-lemon-curd", nameFr: "Lemon curd", nameEn: "Lemon Curd",
    descriptionFr: "Un lemon curd acidulé, tout en fraîcheur.", descriptionEn: "A zesty, fresh lemon curd." },
  { id: "noel-pomme-cannelle", nameFr: "Pomme cannelle", nameEn: "Apple Cinnamon",
    descriptionFr: "Pommes caramélisées, encore croquantes, à la cannelle.", descriptionEn: "Caramelised apples, still crunchy, with cinnamon." },
  { id: "noel-mangue-passion", nameFr: "Mangue passion", nameEn: "Mango Passion Fruit",
    descriptionFr: "Coulis mangue-passion et morceaux de mangue fraîche.", descriptionEn: "Mango and passion fruit coulis with fresh mango pieces." },
  { id: "noel-pate-a-tartiner", nameFr: "Pâte à tartiner", nameEn: "Chocolate Hazelnut Spread",
    descriptionFr: "Façon pâte à tartiner, fondante et gourmande.", descriptionEn: "Hazelnut spread style, rich and melting." },
  { id: "noel-caramel-cacahuetes", nameFr: "Caramel cacahuètes", nameEn: "Caramel Peanut",
    descriptionFr: "Caramel et cacahuètes concassées, snackées pour le croquant.", descriptionEn: "Caramel with crushed roasted peanuts, for the crunch." },
  { id: "noel-chocolat", nameFr: "Chocolat", nameEn: "Chocolate",
    descriptionFr: "Ganache chocolat et copeaux de chocolat.", descriptionEn: "Chocolate ganache and chocolate shavings." },
  { id: "noel-marron", nameFr: "Marron", nameEn: "Chestnut",
    descriptionFr: "Une douce crème de marron.", descriptionEn: "A smooth chestnut cream." },
  { id: "noel-praline", nameFr: "Praliné", nameEn: "Praline",
    descriptionFr: "Praliné, chocolat et crêpes dentelles croustillantes.", descriptionEn: "Praline, chocolate and crispy lace crêpes." },
];

// Parcours : la génoise (base) d'abord, puis la garniture.
// Bûches : génoise vanille ou chocolat + un des 9 parfums de Noël.
// Gâteaux : génoise vanille, chocolat ou red velvet + un des 9 parfums de
// Noël, ou la garniture classique (crème fouettée) — ce qui remplace la
// longue liste habituelle.
export const LOG_FLAVOURS = CHRISTMAS_FLAVOURS;

export const CLASSIC_FILLING: ChristmasFlavour = {
  id: "noel-classique", nameFr: "Classique", nameEn: "Classic",
  descriptionFr: "Notre crème fouettée signature, légère et onctueuse.", descriptionEn: "Our signature whipped cream, light and smooth.",
};

export const CAKE_FLAVOURS: ChristmasFlavour[] = [CLASSIC_FILLING, ...CHRISTMAS_FLAVOURS];

// classicOnly : pas de garniture au choix, toujours la garniture classique
// (crème fouettée) — c'est le cas du red velvet.
export interface Sponge { id: string; fr: string; en: string; cakeOnly?: boolean; classicOnly?: boolean }
export const SPONGES: Sponge[] = [
  { id: "vanille", fr: "Génoise vanille", en: "Vanilla sponge" },
  { id: "chocolat", fr: "Génoise chocolat", en: "Chocolate sponge" },
  { id: "red-velvet", fr: "Génoise red velvet", en: "Red velvet sponge", cakeOnly: true, classicOnly: true },
];

export const LOG_INTRO = {
  fr: "Un roulé ultra moelleux et léger, garni du parfum de votre choix, avec une fine couche de crème.",
  en: "An ultra-soft, light roll, filled with the flavour of your choice, with a thin layer of cream.",
} as const;

export const CHRISTMAS_SIZE_LABELS: Record<ChristmasSize, { fr: string; en: string; peopleFr: string; peopleEn: string }> = {
  bento: { fr: "Bento", en: "Bento", peopleFr: "jusqu’à 4 personnes", peopleEn: "up to 4 people" },
  retro: { fr: "Retro Box", en: "Retro Box", peopleFr: "jusqu’à 4 personnes", peopleEn: "up to 4 people" },
  medium: { fr: "Medium", en: "Medium", peopleFr: "jusqu’à 8 personnes", peopleEn: "up to 8 people" },
  large: { fr: "Large", en: "Large", peopleFr: "jusqu’à 16 personnes", peopleEn: "up to 16 people" },
};

export const CHRISTMAS_SIZE_ORDER: ChristmasSize[] = ["bento", "retro", "medium", "large"];

/** Every photo of a cake or log, in display order ([] when none yet). */
export function cakePhotos(cake: { image: string | null; moreImages?: string[] }): string[] {
  return cake.image ? [cake.image, ...(cake.moreImages ?? [])] : [];
}

/** Lowest price of a cake ("dès CHF 45"). */
export function fromPrice(cake: ChristmasCake): number {
  return Math.min(...Object.values(cake.prices));
}
