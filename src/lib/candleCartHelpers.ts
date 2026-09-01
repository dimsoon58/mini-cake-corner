// Shared candle pricing/naming logic, used by every screen that can add a
// candle to a cart item — standalone (Candles.tsx) or embedded on a cake
// (Catalog/DotCakes/KitBentoCake) — plus Cart.tsx and Checkout.tsx, which
// redisplay and persist those same candles. One formula here instead of a
// copy per file is what keeps prices from silently diverging or dropping
// to CHF 0 when a candle line is recomputed.
import type { CandleSelection } from "@/context/CartContext";

// Number Candle is never a separate catalogue entry (never 10 products) —
// a single digit-picker product, shared everywhere it can be added. Lives
// here rather than in KitBentoCake.tsx to avoid a cycle: this file needs to
// stay dependency-free so any page can import it, including KitBentoCake.tsx
// itself.
export const NUMBER_CANDLE_ID = "number-candle";
export const NUMBER_CANDLE_PRICE = 5;
export const NUMBER_CANDLE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Price of one candle selection, given its catalogue entry (if any). */
export const priceCandleSelection = (
  entry: CandleSelection,
  candle: { unitPrice: number; hasPack?: boolean; packPrice?: number; packSize?: number } | undefined,
  isNumberCandle: boolean
): number => {
  if (isNumberCandle) return entry.quantity * NUMBER_CANDLE_PRICE;
  if (!candle) return 0;
  if (entry.colors) {
    // Explicit "by the piece" colour selection — flat unit price, duplicate
    // colours are forbidden by construction so this never needs pack maths.
    return candle.unitPrice * entry.quantity;
  }
  if (entry.hasPack) {
    // Explicit pack mode — only ever set when the customer chose "Pack" on
    // a colour-family card, so quantity is always an exact multiple of
    // packSize. Never falls through to the automatic-threshold branch below.
    const packSize = candle.packSize || 6;
    return Math.round(entry.quantity / packSize) * (candle.packPrice || 0);
  }
  // Legacy simple candles with no explicit pack/piece choice (Puppy, cars,
  // Blue/Pink Ombré, the plain Spiral models): unchanged automatic
  // threshold — pack pricing kicks in once quantity crosses packSize.
  if (candle.hasPack && entry.quantity >= (candle.packSize || 6)) {
    const packSize = candle.packSize || 6;
    const packs = Math.floor(entry.quantity / packSize);
    const remaining = entry.quantity % packSize;
    return packs * (candle.packPrice || 0) + remaining * candle.unitPrice;
  }
  return candle.unitPrice * entry.quantity;
};

/**
 * Composes the display/persisted name for one candle selection.
 * `candleName` is the base model name ("Shiny Spiral", "Number Candle", ...).
 * `colorLabel` resolves one colour id to its display label — pass an
 * English resolver for persisted data (order_items.candle_name), or a
 * localized one for on-screen display. Omit it where `colors` can't be set
 * yet — the colours branch is then simply never reached.
 */
export const composeCandleName = (
  entry: Pick<CandleSelection, "colors" | "digit">,
  candleName: string,
  colorLabel?: (colorId: string) => string,
): string => {
  if (entry.digit !== undefined) {
    return `${candleName}${entry.digit ? ` – ${entry.digit}` : ""}`;
  }
  if (entry.colors && entry.colors.length > 0 && colorLabel) {
    return `${candleName} – ${entry.colors.map(colorLabel).join(", ")}`;
  }
  return candleName;
};

export const getSimpleCandleQty = (selections: CandleSelection[], candleId: string): number =>
  selections.find(c => c.id === candleId)?.quantity || 0;

// Generic +/- for any plain-stepper candle — never used for a colour-piece
// or explicit-pack entry, which are only ever created/edited through
// ColorFamilyCandleCard's own commit/remove flow.
export const changeSimpleCandleQty = (
  selections: CandleSelection[], candleId: string, delta: number
): CandleSelection[] => {
  const idx = selections.findIndex(c => c.id === candleId);
  if (idx >= 0) {
    const newQty = selections[idx].quantity + delta;
    if (newQty <= 0) return selections.filter((_, i) => i !== idx);
    const copy = [...selections];
    copy[idx] = { ...copy[idx], quantity: newQty };
    return copy;
  }
  return delta > 0 ? [...selections, { id: candleId, quantity: 1, hasPack: false }] : selections;
};

export const upsertCandleSelection = (selections: CandleSelection[], entry: CandleSelection): CandleSelection[] => {
  const idx = selections.findIndex(c => c.id === entry.id);
  if (idx >= 0) {
    const copy = [...selections];
    copy[idx] = entry;
    return copy;
  }
  return [...selections, entry];
};

export const removeCandleSelection = (selections: CandleSelection[], candleId: string): CandleSelection[] =>
  selections.filter(c => c.id !== candleId);
