// Generic BentoCake Studio partner-referral discount — step 2, DISPLAY ONLY.
// Mirrors welcomeDiscount.ts's role exactly: a preview estimate for Cart.tsx
// and Checkout.tsx, never the authoritative amount. The server
// (create-postfinance-payment) independently recomputes the eligible base
// from its own already-validated pricing and the real per-partner rate
// looked up from the `partners` table — this file is never trusted for
// anything financial, and no partner name/rate is ever hardcoded here.

// "Base cake price" — the flat size/pack price ALONE, before shape, flavour,
// design, extras or candles. Mirrors _shared/pricing.ts's CAKE_SIZES /
// DOT_CAKES_PACKS[...].price exactly (NOT welcomeDiscount.ts's
// WELCOME_VOUCHER_BASE, which is a deliberately different, frozen table) —
// duplicated here only because this Vite frontend can't import a Deno
// function's module; keep both in sync if either ever changes.
const PARTNER_BASE_CAKE_PRICE: Record<string, Record<string, number>> = {
  bento_cake: { bento: 40, retro: 40, medium: 85, large: 165 },
  rectangle_cake: { rectangle: 450 },
  dot_cakes: {
    "dot-cakes-4": 35,
    "dot-cakes-6": 51,
    "dot-cakes-9": 75,
    "dot-cakes-12": 99,
    "dot-cakes-20": 160,
  },
};

// Fixed business rule for every partner (never partner-specific).
export const PARTNER_ELIGIBLE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "dot_cakes"]);

export function getPartnerBaseCakePrice(item: { product: string; size: string }): number | null {
  return PARTNER_BASE_CAKE_PRICE[item.product]?.[item.size] ?? null;
}

// Sums the eligible base across every eligible item in the cart — the exact
// figure the partner discount rate is applied to. Never the real sale price
// (which includes flavour/extras/candles) — only ever this flat base.
export function computePartnerEligibleBase<T extends { product: string; size: string }>(
  items: T[],
): number {
  return items.reduce((sum, item) => {
    if (!PARTNER_ELIGIBLE_PRODUCTS.has(item.product)) return sum;
    const base = getPartnerBaseCakePrice(item);
    return base === null ? sum : sum + base;
  }, 0);
}

export function computePartnerDiscountAmount(eligibleBase: number, discountRate: number): number {
  return Math.round(eligibleBase * discountRate * 100) / 100;
}
