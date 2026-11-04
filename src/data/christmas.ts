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
import bucheGrinch1 from "@/assets/buche-grinch-1.jpg";
import bucheGrinch2 from "@/assets/buche-grinch-2.jpg";
import noelCouverture from "@/assets/noel-couverture.jpg";
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
  { id: "noel-sapin", nameFr: "Le Sapin de Noël", nameEn: "Christmas Tree", prices: { retro: 60, medium: 140, large: 230 }, image: noelSapin },
  { id: "noel-cirque", nameFr: "Le Cirque de Noël", nameEn: "Christmas Circus", prices: { retro: 55, medium: 110, large: 190 }, image: noelCirque },
  { id: "noel-royal", nameFr: "Noël Royal", nameEn: "Royal Christmas", prices: { retro: 55, medium: 105, large: 185 }, image: noelRoyal },
  { id: "noel-gui", nameFr: "Gui de Noël", nameEn: "Under the Mistletoe", prices: { retro: 55, medium: 105, large: 185 }, image: noelGui2, moreImages: [noelGui1, noelGui3] },
  { id: "noel-pere-noel", nameFr: "Le Père Noël", nameEn: "Santa Claus", prices: { bento: 50, medium: 100, large: 190 }, image: noelPereNoel },
  { id: "noel-monsieur-neige", nameFr: "Monsieur Neige", nameEn: "Mr Snow", prices: { bento: 50, medium: 100, large: 190 }, image: noelMonsieurNeige },
  { id: "noel-beau-sapin", nameFr: "Mon beau sapin", nameEn: "Little Christmas Tree", prices: { bento: 45, medium: 90, large: 175 }, image: noelBeauSapin },
  { id: "noel-rodolphe", nameFr: "Rodolphe", nameEn: "Rudolph", prices: { bento: 45, medium: 90, large: 175 }, image: noelRodolphe },
];

// Photo de couverture, en haut de la page.
export const CHRISTMAS_COVER = noelCouverture;

// Même prix pour toutes les bûches.
export const CHRISTMAS_LOG_PRICE = 65;

export const CHRISTMAS_LOGS: ChristmasLog[] = [
  { id: "buche-grinch", nameFr: "Grinch", nameEn: "Grinch", image: bucheGrinch1, moreImages: [bucheGrinch2] },
  { id: "buche-jardin-hiver", nameFr: "Le Jardin d’Hiver", nameEn: "Winter Garden", image: bucheJardinHiver1, moreImages: [bucheJardinHiver2] },
  { id: "buche-casse-noisette", nameFr: "Casse-Noisette", nameEn: "Nutcracker", image: bucheCasseNoisette1, moreImages: [bucheCasseNoisette2] },
  { id: "buche-etoile-noel", nameFr: "Étoile de Noël", nameEn: "Christmas Star", image: bucheEtoileNoel1, moreImages: [bucheEtoileNoel2] },
];

// « Christmas Moments » : bandeau de photos en bas de la page (comme
// « Dot Cake Moments »). Ajouter les nouvelles photos ici. Vide = bandeau
// masqué (31.10.2026 : en attente des nouvelles photos de Mel).
export const CHRISTMAS_MOMENTS: string[] = [];

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
  { id: "noel-chocolat", nameFr: "Chocolate Lovers", nameEn: "Chocolate Lovers",
    descriptionFr: "Ganache chocolat et copeaux de chocolat.", descriptionEn: "Chocolate ganache and chocolate shavings." },
  { id: "noel-marron", nameFr: "Marron", nameEn: "Chestnut",
    descriptionFr: "Une douce crème de marron.", descriptionEn: "A smooth chestnut cream." },
];

// 03.11.2026 (Mel) : plus de choix de génoise. Le praliné (crêpes
// dentelles) est retiré ; « Chocolat » s'appelle Chocolate Lovers ; la
// garniture « Classique » devient Vanille classique et Chocolat classique.
// Bûches : la liste « Christmas Edition » ci-dessous. Gâteaux : un seul menu
// avec « Nos classiques » (les goûts habituels du site) puis exactement la
// même liste « Christmas Edition » que les bûches.
export const CLASSIC_VANILLA: ChristmasFlavour = {
  id: "noel-vanille-classique", nameFr: "Vanille classique", nameEn: "Classic Vanilla",
  descriptionFr: "Génoise vanille et notre crème fouettée signature.", descriptionEn: "Vanilla sponge with our signature whipped cream.",
};
export const CLASSIC_CHOCOLATE: ChristmasFlavour = {
  id: "noel-chocolat-classique", nameFr: "Chocolat classique", nameEn: "Classic Chocolate",
  descriptionFr: "Génoise chocolat et notre crème fouettée signature.", descriptionEn: "Chocolate sponge with our signature whipped cream.",
};

// Christmas Edition : supplément par garniture (décision du 31.10.2026), en
// CHF, ajouté au prix de la bûche. Les deux classiques = +0.
// Ordre du menu = ordre de cette liste.
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

const EDITION_FLAVOURS = [CLASSIC_VANILLA, CLASSIC_CHOCOLATE, ...CHRISTMAS_FLAVOURS];
export const LOG_FLAVOURS: ChristmasFlavour[] = Object.keys(LOG_FLAVOUR_SURCHARGES).map(
  (id) => EDITION_FLAVOURS.find((f) => f.id === id)!,
);

// « Nos classiques » : les goûts habituels des bento cakes (même liste et
// mêmes suppléments que la personnalisation, sans la pistache), avec les
// textes français du Bento Kit.
type SizePrices = Record<ChristmasSize, number>;
const STANDARD: SizePrices = { bento: 0, retro: 0, medium: 0, large: 0 };
const SPECIAL: SizePrices = { bento: 2, retro: 2, medium: 5, large: 10 };
const DELUXE: SizePrices = { bento: 4, retro: 4, medium: 10, large: 15 };
const classic = (id: string, name: string, descriptionFr: string, descriptionEn: string, prices: SizePrices) =>
  ({ id, nameFr: name, nameEn: name, descriptionFr, descriptionEn, prices });
export const CLASSIC_CAKE_FLAVOURS: (ChristmasFlavour & { prices: SizePrices })[] = [
  classic("vanilla", "Vanilla", "Génoise vanille moelleuse et crème fouettée", "Fluffy vanilla sponge with whipped cream", STANDARD),
  classic("red-velvet", "Red Velvet", "Génoise vanille et chocolat moelleuse et crème fouettée", "Fluffy vanilla and chocolate sponge with whipped cream", STANDARD),
  classic("chocolate", "Chocolate", "Génoise chocolat moelleuse et crème fouettée", "Fluffy chocolate sponge with whipped cream", STANDARD),
  classic("chocolate-lovers", "Chocolate Lovers", "Génoise chocolat moelleuse et riche ganache au chocolat", "Moist chocolate sponge with rich chocolate ganache", SPECIAL),
  classic("chocolate-lover-berrylicious", "Chocolate Lover x Berrylicious", "Génoise chocolat, coulis de framboise et ganache au chocolat", "Chocolate sponge with raspberry coulis and chocolate ganache", SPECIAL),
  classic("dark-berrylicious", "Dark Berrylicious", "Génoise chocolat moelleuse garnie d'un généreux coulis de framboise et de crème fouettée", "Fluffy chocolate sponge filled with a generous raspberry coulis and whipped cream", SPECIAL),
  classic("white-berrylicious", "White Berrylicious", "Génoise vanille moelleuse garnie d'un généreux coulis de framboise et de crème fouettée", "Fluffy vanilla sponge filled with a generous raspberry coulis and whipped cream", SPECIAL),
  classic("salted-caramel", "Salted Butter Caramel", "Génoise vanille moelleuse garnie de caramel et de crème fouettée", "Fluffy vanilla sponge filled with caramel and whipped cream", SPECIAL),
  classic("lemon-curd", "Lemon Curd", "Génoise vanille moelleuse garnie de lemon curd et de crème fouettée", "Fluffy vanilla sponge filled with lemon curd and whipped cream", SPECIAL),
  classic("tiramisu", "Tiramisu", "Génoise vanille moelleuse garnie de café frais et de crème fouettée", "Fluffy vanilla sponge filled with fresh coffee and whipped cream", DELUXE),
  classic("praline", "Praline Obsession", "Génoise vanille moelleuse garnie d'amandes et de noisettes caramélisées et de crème fouettée", "Fluffy vanilla sponge filled with caramelised almond, hazelnut and whipped cream", DELUXE),
  classic("passion-fruit", "Passion Fruit", "Génoise vanille moelleuse garnie de curd de fruit de la passion et de crème fouettée", "Fluffy vanilla sponge filled with fresh passion fruit curd and whipped cream", DELUXE),
  classic("vanilla-gf", "Vanilla Gluten-Free", "Génoise vanille sans gluten, moelleuse et crème fouettée", "Fluffy gluten-free vanilla sponge with whipped cream", DELUXE),
  classic("red-velvet-gf", "Red Velvet Gluten-Free", "Génoise vanille et chocolat sans gluten, moelleuse et crème fouettée", "Fluffy gluten-free vanilla and chocolate sponge with whipped cream", DELUXE),
  classic("chocolate-gf", "Chocolate Gluten-Free", "Génoise chocolat sans gluten, moelleuse et crème fouettée", "Fluffy gluten-free chocolate sponge with whipped cream", DELUXE),
];

// Gâteaux : supplément selon la taille. Nos classiques : celui du site.
// Christmas Edition : calculé depuis celui des bûches (31.10.2026) —
// bento / retro : la moitié, medium : le même, large : bento + medium.
export function cakeFlavourSurcharge(flavourId: string, size: ChristmasSize): number {
  const classicFlavour = CLASSIC_CAKE_FLAVOURS.find((f) => f.id === flavourId);
  if (classicFlavour) return classicFlavour.prices[size];
  const log = LOG_FLAVOUR_SURCHARGES[flavourId] ?? 0;
  const small = log / 2;
  if (size === "bento" || size === "retro") return small;
  if (size === "medium") return log;
  return small + log;
}

export const LOG_INTRO = {
  fr: "Un roulé ultra moelleux et léger, garni du parfum de votre choix, avec une fine couche de crème.",
  en: "An ultra-soft, light roll, filled with the flavour of your choice, with a thin layer of cream.",
} as const;

// Taille unique des bûches (affichée sur la page).
export const LOG_SIZE = {
  people: { fr: "8 à 12 personnes", en: "8 to 12 people" },
  dimensions: { fr: "Dimensions : 30 × 10 × 10 cm", en: "Dimensions: 30 × 10 × 10 cm" },
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
