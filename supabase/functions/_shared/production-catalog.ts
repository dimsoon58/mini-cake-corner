// Single source of the Admin > Production mappings (validated with the owner
// on 2026-09-28): flavour → sponge base and ingredients, product → production
// category, and normalisation of the flavour values actually stored in
// order_items.flavors. Those are DISPLAY NAMES, not flavour ids, with
// historical variants ("Standard — Vanilla", "Chocolate (Standard Flavours)",
// "Vanilla Gluten-Free"…), so every lookup goes through normaliseFlavourKey().
// Anything not recognised resolves to null → "Non classé — à vérifier",
// never guessed and never silently dropped.

import { DOT_CAKES_PACKS } from "./pricing.ts";

export type SpongeBase =
  | "vanilla" | "chocolate" | "red_velvet"
  | "vanilla_gf" | "chocolate_gf" | "red_velvet_gf";

export type ProductionCategory =
  | "bento_round" | "bento_heart" | "medium_round" | "medium_heart"
  | "large_round" | "large_heart" | "rectangle" | "dot_cake";

export type Ingredient =
  | "raspberry" | "ganache" | "salted_caramel" | "lemon" | "coffee"
  | "praline" | "pistachio" | "passion_fruit" | "orange_blossom" | "cream_cheese";

export const SPONGE_BASES: SpongeBase[] = [
  "vanilla", "chocolate", "red_velvet", "vanilla_gf", "chocolate_gf", "red_velvet_gf",
];

export const PRODUCTION_CATEGORIES: ProductionCategory[] = [
  "bento_round", "bento_heart", "medium_round", "medium_heart",
  "large_round", "large_heart", "rectangle", "dot_cake",
];

export interface FlavourDef {
  id: string;
  base: SpongeBase;
  ingredients: Ingredient[];
  // Every label the site has stored for this flavour (catalogue name +
  // known variants). The id itself is always accepted too.
  names: string[];
}

export const PRODUCTION_FLAVOURS: FlavourDef[] = [
  { id: "vanilla",                      base: "vanilla",       ingredients: [],                       names: ["Vanilla"] },
  { id: "red-velvet",                   base: "red_velvet",    ingredients: ["cream_cheese"],         names: ["Red Velvet"] },
  { id: "chocolate",                    base: "chocolate",     ingredients: [],                       names: ["Chocolate"] },
  { id: "chocolate-lovers",             base: "chocolate",     ingredients: ["ganache"],              names: ["Chocolate Lovers"] },
  { id: "dark-berrylicious",            base: "chocolate",     ingredients: ["raspberry"],            names: ["Dark Berrylicious"] },
  { id: "white-berrylicious",           base: "vanilla",       ingredients: ["raspberry"],            names: ["White Berrylicious"] },
  { id: "salted-caramel",               base: "vanilla",       ingredients: ["salted_caramel"],       names: ["Salted Butter Caramel", "Salted Caramel"] },
  { id: "lemon-curd",                   base: "vanilla",       ingredients: ["lemon"],                names: ["Lemon Curd"] },
  { id: "chocolate-lover-berrylicious", base: "chocolate",     ingredients: ["raspberry", "ganache"], names: ["Chocolate Lover x Berrylicious"] },
  { id: "tiramisu",                     base: "vanilla",       ingredients: ["coffee"],               names: ["Tiramisu"] },
  { id: "praline",                      base: "vanilla",       ingredients: ["praline"],              names: ["Praline Obsession", "Praline"] },
  { id: "pistachio-lovers",             base: "vanilla",       ingredients: ["pistachio"],            names: ["Pistachio Lovers"] },
  { id: "passion-fruit",                base: "vanilla",       ingredients: ["passion_fruit"],        names: ["Passion Fruit"] },
  { id: "vanilla-gf",                   base: "vanilla_gf",    ingredients: [],                       names: ["Vanilla Gluten-Free"] },
  { id: "red-velvet-gf",                base: "red_velvet_gf", ingredients: ["cream_cheese"],         names: ["Red Velvet Gluten-Free"] },
  { id: "chocolate-gf",                 base: "chocolate_gf",  ingredients: [],                       names: ["Chocolate Gluten-Free"] },
  { id: "chocolate-gf-berrylicious",    base: "chocolate_gf",  ingredients: ["raspberry"],            names: ["Chocolate GF × Berrylicious"] },
  { id: "vanilla-gf-berrylicious",      base: "vanilla_gf",    ingredients: ["raspberry"],            names: ["Vanilla GF × Berrylicious"] },
  { id: "lemon-curd-gf",                base: "vanilla_gf",    ingredients: ["lemon"],                names: ["Lemon Curd Gluten-free"] },
  { id: "chocolate-lovers-gf",          base: "chocolate_gf",  ingredients: ["ganache"],              names: ["Chocolate Lovers Gluten-free"] },
  { id: "orange-blossom-gf",            base: "vanilla_gf",    ingredients: ["orange_blossom"],       names: ["Orange Blossom Gluten-free"] },
  { id: "pistachio-gf",                 base: "vanilla_gf",    ingredients: ["pistachio"],            names: ["Pistachio Gluten-free"] },
  { id: "tiramisu-gf",                  base: "vanilla_gf",    ingredients: ["coffee"],               names: ["Tiramisu Gluten-free"] },
  { id: "passion-fruit-gf",             base: "vanilla_gf",    ingredients: ["passion_fruit"],        names: ["Passion Fruit Gluten-free"] },
  { id: "praline-gf",                   base: "vanilla_gf",    ingredients: ["praline"],              names: ["Praline Gluten-free"] },
];

export const FLAVOUR_BY_ID = new Map(PRODUCTION_FLAVOURS.map((f) => [f.id, f]));

// "Standard — Vanilla" → "vanilla"; "Chocolate (Standard Flavours)" →
// "chocolate"; "Vanilla Gluten-Free" / "vanilla-gf" → "vanilla gf";
// "Chocolate GF × Berrylicious" → "chocolate gf x berrylicious".
export function normaliseFlavourKey(raw: string): string {
  let s = raw.trim();
  // Tier prefix: keep only what follows the last spaced dash.
  const parts = s.split(/\s[—–-]\s/);
  s = parts[parts.length - 1];
  // Tier suffix in parentheses.
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/×/g, "x")
    .replace(/gluten[\s-]?free|sans gluten/g, "gf")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const FLAVOUR_BY_KEY = new Map<string, FlavourDef>();
for (const f of PRODUCTION_FLAVOURS) {
  for (const label of [f.id, ...f.names]) FLAVOUR_BY_KEY.set(normaliseFlavourKey(label), f);
}

export function resolveFlavour(raw: string | null | undefined): FlavourDef | null {
  if (!raw || !raw.trim()) return null;
  return FLAVOUR_BY_KEY.get(normaliseFlavourKey(raw)) ?? null;
}

// Workshop sponge choice ('vanilla' / 'chocolate', per participant).
export function workshopSpongeFlavour(choice: string): FlavourDef | null {
  return choice === "vanilla" || choice === "chocolate" ? FLAVOUR_BY_ID.get(choice) ?? null : null;
}

// "skip" = not a cake (edible printing, candles). null = a cake whose
// category can't be determined safely → "à confirmer" (shape never guessed).
export function productionCategory(
  product: string | null,
  size: string | null,
  shape: string | null,
): ProductionCategory | "skip" | null {
  const heart = shape === "heart";
  const round = shape === "round";
  switch (product) {
    case "edible_printing":
    case "candles":
      return "skip";
    case "rectangle_cake":
      return "rectangle";
    case "dot_cakes":
      return "dot_cake";
    case "workshop":
      return "bento_round"; // every participant gets a round Bento prepared in advance
    case "diy_kit":
      return round ? "bento_round" : heart ? "bento_heart" : null;
    case "bento_cake":
      if (size === "rectangle") return "rectangle";
      if (size === "bento" || size === "retro") return round ? "bento_round" : heart ? "bento_heart" : null;
      if (size === "medium") return round ? "medium_round" : heart ? "medium_heart" : null;
      if (size === "large") return round ? "large_round" : heart ? "large_heart" : null;
      return null;
    default:
      return null;
  }
}

// Dot Cakes: a pack of N small cakes split over M flavours → N / M per
// flavour chosen (same pack table as the price engine).
export function dotCakePack(size: string | null): { total: number; flavours: number; perFlavour: number } | null {
  const pack = size ? DOT_CAKES_PACKS[size] : undefined;
  return pack ? { total: pack.size, flavours: pack.flavours, perFlavour: pack.size / pack.flavours } : null;
}
