// Single server-side source of truth for every product price. Never trust
// item.total from the client — this module is the only place a charge is
// ever computed. Every lookup either resolves to a real number or fails
// explicitly (PricingResult.ok === false) — there is no `?? 0` / `|| 0`
// fallback anywhere in this file, by design: an unknown id must reject the
// transaction, never silently charge nothing.

export const NUMBER_CANDLE_ID = "number-candle";
export const NUMBER_CANDLE_PRICE = 5;
export const NUMBER_CANDLE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export type PricingResult = { ok: true; total: number } | { ok: false; reason: string };

export interface CandleInput {
  id: string;
  quantity: number;
  hasPack: boolean;
  colors?: string[];
  digit?: string;
}

export interface PricingInput {
  product: string;
  size: string | null;
  shape: string | null;
  // Raw flavour ids — one entry for bento/rectangle/diy_kit, 1..N for dot_cakes.
  flavors: string[];
  design: string | null; // = style id
  extras: string[];
  candles: CandleInput[];
}

const fail = (reason: string): PricingResult => ({ ok: false, reason });

// ── Bento / Retro / Medium / Large / Rectangle ─────────────────────────────
// Source of truth verified against Catalog.tsx (the live add-to-cart page)
// on 2026-08-26. `data/customization.ts` and Catalog.tsx were found to
// diverge on 3 rectangle designs — data/customization.ts has since been
// corrected to match, and this table follows that corrected version.

type SizeKey = "bento" | "retro" | "medium" | "large" | "rectangle";
type SizePriceMap = Partial<Record<SizeKey, number>>;

export const CAKE_SIZES: Record<SizeKey, number> = {
  bento: 40, retro: 45, medium: 85, large: 165, rectangle: 450,
};

export const CAKE_SHAPES: Record<string, SizePriceMap> = {
  round: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  heart: { bento: 3, retro: 3, medium: 5, large: 5 },
};

export const CAKE_FLAVORS: Record<string, SizePriceMap> = {
  // Standard
  vanilla: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  "red-velvet": { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  chocolate: { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  // Special
  "chocolate-lovers": { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
  "dark-berrylicious": { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
  "white-berrylicious": { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
  "salted-caramel": { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
  "lemon-curd": { bento: 2, retro: 2, medium: 5, large: 10, rectangle: 20 },
  // Deluxe
  "chocolate-lover-berrylicious": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  tiramisu: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  praline: { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  "pistachio-lovers": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  "passion-fruit": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  "vanilla-gf": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  "red-velvet-gf": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  "chocolate-gf": { bento: 4, retro: 4, medium: 10, large: 15, rectangle: 30 },
  // Gluten-Free Premium
  "chocolate-gf-berrylicious": { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 },
  "vanilla-gf-berrylicious": { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 },
  "lemon-curd-gf": { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 },
  "chocolate-lovers-gf": { bento: 6, retro: 6, medium: 15, large: 25, rectangle: 50 },
  // Gluten-Free Deluxe
  "orange-blossom-gf": { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
  "pistachio-gf": { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
  "tiramisu-gf": { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
  "passion-fruit-gf": { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
  "praline-gf": { bento: 8, retro: 8, medium: 20, large: 30, rectangle: 60 },
};

export const CAKE_DESIGNS: Record<string, SizePriceMap> = {
  "normal-without-border": { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  "normal-with-border": { bento: 0, retro: 0, medium: 0, large: 0, rectangle: 0 },
  "heart-bomb": { bento: 3, retro: 5, medium: 10, large: 15, rectangle: 20 },
  "retro-vintage": { retro: 6, medium: 10, large: 15, rectangle: 30 },
  "glitter-cherries-retro": { retro: 13, medium: 20, large: 30, rectangle: 55 },
  "pearl-border-retro": { retro: 40, medium: 67, large: 98, rectangle: 225 },
  "retro-ribbons": { retro: 11, medium: 18, large: 25, rectangle: 50 },
  "roses-please": { bento: 6, retro: 8, medium: 15, large: 20, rectangle: 40 },
  "retro-glitter-cake": { retro: 11, medium: 20, large: 27, rectangle: 55 },
  "printed-picture": { bento: 15, retro: 15, medium: 15, large: 15 },
  "shag-cake": { retro: 12, medium: 20, large: 30, rectangle: 50 },
  "rainbow-cake": { retro: 15, medium: 20, large: 30, rectangle: 50 },
  "custom-drawing": { bento: 8, retro: 8, medium: 10, large: 15 },
  "cherries-retro": { retro: 10, medium: 18, large: 27, rectangle: 50 },
  "scattered-retro-pearls": { retro: 10, medium: 16, large: 23, rectangle: 45 },
  "gold-leaves-style": { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 },
  "golden-cake": { retro: 15, medium: 25, large: 40, rectangle: 70 },
  "pearl-number": { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 },
  "retro-ribbons-glitter": { retro: 21, medium: 33, large: 45 },
  "butterfly-garden": { retro: 10, medium: 15, large: 20, rectangle: 35 },
  "glitter-base": { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 },
  "gender-reveal": { bento: 5, retro: 5, medium: 10, large: 15, rectangle: 40 },
  "sprinkles-with-border": { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 },
  "rectangle-signature": { rectangle: 30 },
  "rectangle-raspberries": { rectangle: 60 },
  "rectangle-flowers": { rectangle: 45 },
};

export const CAKE_EXTRAS: Record<string, SizePriceMap> = {
  "gold-leaves": { bento: 3, retro: 4, medium: 5, large: 8, rectangle: 12 },
  cherries: { retro: 4, medium: 8, large: 12, rectangle: 20 },
  "glitter-cherries": { retro: 7, medium: 10, large: 15, rectangle: 25 },
  "scattered-pearl": { bento: 2, retro: 4, medium: 6, large: 8, rectangle: 15 },
  glitter: { bento: 5, retro: 5, medium: 10, large: 12, rectangle: 25 },
  "glitter-base": { bento: 8, retro: 8, medium: 10, large: 12, rectangle: 25 },
  "glitter-in-the-air": { bento: 10, retro: 10, medium: 15, large: 20 },
  "pearl-border": { retro: 10, medium: 17, large: 25, rectangle: 60 },
  retro: { retro: 6, medium: 10, large: 15, rectangle: 30 },
  ribbons: { retro: 5, medium: 8, large: 10, rectangle: 20 },
  "pearl-number": { bento: 6, retro: 6, medium: 6, large: 6, rectangle: 10 },
  butterfly: { retro: 6, medium: 8, large: 10, rectangle: 20 },
  sprinkles: { bento: 3, retro: 4, medium: 5, large: 6, rectangle: 10 },
  "printed-picture": { bento: 15, retro: 15, medium: 15, large: 15 },
};

// ── Candles (shared by embedded and standalone purchases) ─────────────────

interface CandleCatalogEntry {
  unitPrice: number;
  hasPack: boolean;
  packSize?: number;
  packPrice?: number;
}

export const CANDLES: Record<string, CandleCatalogEntry> = {
  puppy: { unitPrice: 2, hasPack: false },
  "teddy-bear": { unitPrice: 2, hasPack: false },
  cherry: { unitPrice: 2, hasPack: false },
  heart: { unitPrice: 2, hasPack: false },
  daisy: { unitPrice: 2, hasPack: false },
  ribbon: { unitPrice: 2, hasPack: false },
  soccer: { unitPrice: 2, hasPack: false },
  "pink-car": { unitPrice: 2, hasPack: false },
  "red-car": { unitPrice: 2, hasPack: false },
  "blue-car": { unitPrice: 2, hasPack: false },
  "yellow-car": { unitPrice: 2, hasPack: false },
  "pink-ombre": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "blue-ombre": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  rainbow: { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "spiral-pastel": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "shiny-spiral": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "thick-spiral": { unitPrice: 2, hasPack: true, packSize: 6, packPrice: 10 },
  "pink-gold-spiral": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "silver-spiral": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "gold-spiral": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
  "spiral-champagne": { unitPrice: 1, hasPack: true, packSize: 6, packPrice: 5 },
};

export const FAMILY_CANDLE_COLORS: Record<string, string[]> = {
  "thick-spiral": ["green", "blue", "purple", "pink", "yellow"],
  "shiny-spiral": ["red", "purple", "green", "gold", "pink", "blue"],
  "spiral-pastel": ["blue", "purple", "dark-pink", "light-pink", "yellow", "green"],
  rainbow: ["turquoise", "dark-blue", "blue", "green", "purple", "light-pink", "dark-pink", "yellow", "orange"],
};

function priceCandle(entry: CandleInput): PricingResult {
  if (entry.digit !== undefined) {
    if (entry.id !== NUMBER_CANDLE_ID) return fail(`unknown candle id for digit entry: ${entry.id}`);
    if (!NUMBER_CANDLE_DIGITS.includes(entry.digit)) return fail(`invalid digit: ${entry.digit}`);
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) return fail("invalid candle quantity");
    return { ok: true, total: entry.quantity * NUMBER_CANDLE_PRICE };
  }

  const candle = CANDLES[entry.id];
  if (!candle) return fail(`unknown candle id: ${entry.id}`);

  if (entry.colors) {
    const family = FAMILY_CANDLE_COLORS[entry.id];
    if (!family) return fail(`${entry.id} has no colour family — colors not allowed`);
    const packSize = candle.packSize ?? 6;
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) return fail("invalid candle quantity");
    if (entry.colors.length !== entry.quantity) return fail("colour count must equal quantity");
    if (entry.quantity > packSize - 1) return fail("too many loose pieces for this candle — use a pack");
    if (new Set(entry.colors).size !== entry.colors.length) return fail("duplicate colours not allowed");
    if (!entry.colors.every((c) => family.includes(c))) return fail("unknown colour id for this candle family");
    return { ok: true, total: candle.unitPrice * entry.quantity };
  }

  if (entry.hasPack) {
    if (!candle.hasPack) return fail(`${entry.id} has no pack mode`);
    const packSize = candle.packSize ?? 6;
    if (!Number.isInteger(entry.quantity) || entry.quantity < packSize || entry.quantity % packSize !== 0) {
      return fail("pack quantity must be an exact positive multiple of the pack size");
    }
    return { ok: true, total: (entry.quantity / packSize) * (candle.packPrice ?? 0) };
  }

  if (!Number.isInteger(entry.quantity) || entry.quantity < 1) return fail("invalid candle quantity");
  if (candle.hasPack && entry.quantity >= (candle.packSize ?? 6)) {
    const packSize = candle.packSize ?? 6;
    const packs = Math.floor(entry.quantity / packSize);
    const remaining = entry.quantity % packSize;
    return { ok: true, total: packs * (candle.packPrice ?? 0) + remaining * candle.unitPrice };
  }
  return { ok: true, total: candle.unitPrice * entry.quantity };
}

function priceCandles(candles: CandleInput[]): PricingResult {
  let total = 0;
  for (const entry of candles) {
    const r = priceCandle(entry);
    if (!r.ok) return r;
    total += r.total;
  }
  return { ok: true, total };
}

// ── DIY Kit ─────────────────────────────────────────────────────────────
// Single fixed size ("kit-bento") — every table below is flat, not
// size-keyed. Flavour set intentionally narrower than CAKE_FLAVORS: only
// what KitBentoCake.tsx actually offers today (no pistachio-lovers, per
// explicit instruction to keep current product availability as-is).

export const DIY_KIT_BASE_PRICE = 40;
export const DIY_KIT_SHAPES: Record<string, number> = { round: 0, heart: 3 };
export const DIY_KIT_PIPING: Record<string, number> = { "piping-2-bags": 0, "piping-3-bags": 2 };

export const DIY_KIT_FLAVORS: Record<string, number> = {
  vanilla: 0, "red-velvet": 0, chocolate: 0,
  "chocolate-lovers": 2, "dark-berrylicious": 2, "white-berrylicious": 2, "salted-caramel": 2, "lemon-curd": 2,
  "chocolate-lover-berrylicious": 4, tiramisu: 4, praline: 4, "passion-fruit": 4,
  "vanilla-gf": 4, "red-velvet-gf": 4, "chocolate-gf": 4,
  "chocolate-gf-berrylicious": 6, "vanilla-gf-berrylicious": 6, "lemon-curd-gf": 6, "chocolate-lovers-gf": 6,
  "orange-blossom-gf": 8, "pistachio-gf": 8, "tiramisu-gf": 8, "passion-fruit-gf": 8, "praline-gf": 8,
};

// ── Dot Cakes ───────────────────────────────────────────────────────────
// Same flavour-tier restriction as DIY Kit above, minus the Gluten-Free
// Premium/Deluxe tiers — DotCakes.tsx never imports those, so they are not
// currently purchasable there either.

export const DOT_CAKES_PACKS: Record<string, { size: number; flavours: number; price: number }> = {
  "dot-cakes-4": { size: 4, flavours: 2, price: 35 },
  "dot-cakes-6": { size: 6, flavours: 3, price: 51 },
  "dot-cakes-9": { size: 9, flavours: 3, price: 75 },
  "dot-cakes-12": { size: 12, flavours: 4, price: 99 },
  "dot-cakes-20": { size: 20, flavours: 5, price: 160 },
};

export const DOT_CAKES_FLAVOR_TIER: Record<string, number> = {
  vanilla: 0, "red-velvet": 0, chocolate: 0,
  "chocolate-lovers": 1.5, "dark-berrylicious": 1.5, "white-berrylicious": 1.5, "salted-caramel": 1.5, "lemon-curd": 1.5,
  "chocolate-lover-berrylicious": 2.5, tiramisu: 2.5, praline: 2.5, "passion-fruit": 2.5,
  "vanilla-gf": 2.5, "red-velvet-gf": 2.5, "chocolate-gf": 2.5,
};

// ── Edible Printing ─────────────────────────────────────────────────────
export const EDIBLE_PRINTING_PRICE = 15;

// ── Per-product recompute ───────────────────────────────────────────────

function priceCakeFamily(input: PricingInput, product: "bento_cake" | "rectangle_cake"): PricingResult {
  const validSizes = product === "rectangle_cake" ? ["rectangle"] : ["bento", "retro", "medium", "large"];
  if (!input.size || !validSizes.includes(input.size)) return fail(`invalid size ${input.size} for ${product}`);
  const size = input.size as SizeKey;

  const basePrice = CAKE_SIZES[size];

  const shape = input.shape || "round";
  const shapePrice = CAKE_SHAPES[shape]?.[size];
  if (shapePrice === undefined) return fail(`shape ${shape} unavailable for size ${size}`);

  if (input.flavors.length !== 1) return fail("exactly one flavor expected for this product");
  const flavorPrice = CAKE_FLAVORS[input.flavors[0]]?.[size];
  if (flavorPrice === undefined) return fail(`flavor ${input.flavors[0]} unavailable for size ${size}`);

  if (!input.design) return fail("design is required");
  const designPrice = CAKE_DESIGNS[input.design]?.[size];
  if (designPrice === undefined) return fail(`design ${input.design} unavailable for size ${size}`);

  let extrasTotal = 0;
  for (const extraId of input.extras) {
    const price = CAKE_EXTRAS[extraId]?.[size];
    if (price === undefined) return fail(`extra ${extraId} unavailable for size ${size}`);
    extrasTotal += price;
  }

  const candlesResult = priceCandles(input.candles);
  if (!candlesResult.ok) return candlesResult;

  return { ok: true, total: basePrice + shapePrice + flavorPrice + designPrice + extrasTotal + candlesResult.total };
}

function priceDiyKit(input: PricingInput): PricingResult {
  if (input.size !== "kit-bento") return fail(`invalid size ${input.size} for diy_kit`);
  const shape = input.shape || "round";
  const shapePrice = DIY_KIT_SHAPES[shape];
  if (shapePrice === undefined) return fail(`unknown shape ${shape}`);
  if (input.flavors.length !== 1) return fail("exactly one flavor expected");
  const flavorPrice = DIY_KIT_FLAVORS[input.flavors[0]];
  if (flavorPrice === undefined) return fail(`unknown or unavailable flavor ${input.flavors[0]} for diy_kit`);
  const pipingExtras = input.extras.filter((e) => e in DIY_KIT_PIPING);
  if (pipingExtras.length !== 1 || input.extras.length !== 1) return fail("exactly one piping option expected");
  const pipingPrice = DIY_KIT_PIPING[pipingExtras[0]];
  const candlesResult = priceCandles(input.candles);
  if (!candlesResult.ok) return candlesResult;
  return { ok: true, total: DIY_KIT_BASE_PRICE + shapePrice + flavorPrice + pipingPrice + candlesResult.total };
}

function priceDotCakes(input: PricingInput): PricingResult {
  const pack = input.size ? DOT_CAKES_PACKS[input.size] : undefined;
  if (!pack) return fail(`invalid dot cakes pack ${input.size}`);
  if (input.flavors.length < 1 || input.flavors.length > pack.flavours) return fail("invalid flavour count for this pack");
  if (new Set(input.flavors).size !== input.flavors.length) return fail("duplicate flavours");

  const dotsPerFlavour = pack.size / input.flavors.length;
  let surcharge = 0;
  for (const flavorId of input.flavors) {
    const tier = DOT_CAKES_FLAVOR_TIER[flavorId];
    if (tier === undefined) return fail(`flavor ${flavorId} unavailable for dot_cakes`);
    surcharge += dotsPerFlavour * tier;
  }
  const candlesResult = priceCandles(input.candles);
  if (!candlesResult.ok) return candlesResult;
  return { ok: true, total: Math.round((pack.price + surcharge + candlesResult.total) * 100) / 100 };
}

function priceEdiblePrinting(input: PricingInput): PricingResult {
  if (input.size !== "printing") return fail(`invalid size ${input.size} for edible_printing`);
  return { ok: true, total: EDIBLE_PRINTING_PRICE };
}

function priceStandaloneCandles(input: PricingInput): PricingResult {
  if (input.candles.length !== 1) return fail("standalone candle line must have exactly one candle entry");
  return priceCandle(input.candles[0]);
}

export function priceOrderItem(input: PricingInput): PricingResult {
  switch (input.product) {
    case "bento_cake": return priceCakeFamily(input, "bento_cake");
    case "rectangle_cake": return priceCakeFamily(input, "rectangle_cake");
    case "diy_kit": return priceDiyKit(input);
    case "dot_cakes": return priceDotCakes(input);
    case "edible_printing": return priceEdiblePrinting(input);
    case "candles": return priceStandaloneCandles(input);
    default: return fail(`unknown product ${input.product}`);
  }
}
