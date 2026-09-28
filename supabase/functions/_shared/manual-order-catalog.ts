// Admin manual orders — the options the form may offer, derived DIRECTLY
// from the pricing engine's own tables (_shared/pricing.ts): a size, flavour,
// design, extra or candle is only ever offered where priceOrderItem() would
// accept it. No price and no availability rule is copied here. Display
// names for flavours come from the Production catalogue (the site's names);
// every other label is resolved on the frontend from the site's existing
// label helpers.

import {
  CAKE_DESIGNS,
  CAKE_EXTRAS,
  CAKE_FLAVORS,
  CAKE_SHAPES,
  CAKE_SIZES,
  CANDLES,
  DIY_KIT_FLAVORS,
  DIY_KIT_PIPING,
  DIY_KIT_SHAPES,
  DOT_CAKES_FLAVOR_TIER,
  DOT_CAKES_PACKS,
  FAMILY_CANDLE_COLORS,
  INSPIRATION_DESIGNS,
  NUMBER_CANDLE_ID,
} from "./pricing.ts";
import { FLAVOUR_BY_ID } from "./production-catalog.ts";

const flavourName = (id: string) => FLAVOUR_BY_ID.get(id)?.names[0] ?? id;

// deno-lint-ignore no-explicit-any
export async function buildManualOrderCatalog(supabase: any) {
  const sizes = Object.keys(CAKE_SIZES);
  const bySize = <T>(fn: (size: string) => T) => Object.fromEntries(sizes.map((s) => [s, fn(s)]));
  const availableIn = (table: Record<string, Record<string, number>>, size: string) =>
    Object.keys(table).filter((k) => table[k]?.[size] !== undefined);

  const { data: sessions, error } = await supabase.rpc("get_workshop_availability");
  if (error) throw new Error(`Failed to load workshop sessions: ${error.message}`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

  return {
    cake: {
      // bento_cake: bento / retro / medium / large — rectangle_cake: rectangle
      sizes: sizes.map((id) => ({ id, basePrice: CAKE_SIZES[id as keyof typeof CAKE_SIZES] })),
      shapes: bySize((s) => availableIn(CAKE_SHAPES, s)),
      flavours: bySize((s) => availableIn(CAKE_FLAVORS, s).map((id) => ({ id, name: flavourName(id) }))),
      designs: bySize((s) => availableIn(CAKE_DESIGNS, s)),
      inspirationDesigns: bySize((s) => availableIn(INSPIRATION_DESIGNS, s)),
      extras: bySize((s) => availableIn(CAKE_EXTRAS, s)),
    },
    kit: {
      size: "kit-bento",
      shapes: Object.keys(DIY_KIT_SHAPES),
      flavours: Object.keys(DIY_KIT_FLAVORS).map((id) => ({ id, name: flavourName(id) })),
      piping: Object.keys(DIY_KIT_PIPING),
    },
    dotCakes: {
      packs: Object.entries(DOT_CAKES_PACKS).map(([id, p]) => ({ id, size: p.size, flavours: p.flavours, price: p.price })),
      flavours: Object.keys(DOT_CAKES_FLAVOR_TIER).map((id) => ({ id, name: flavourName(id) })),
    },
    printing: { size: "printing" },
    candles: {
      numberCandleId: NUMBER_CANDLE_ID,
      catalogue: Object.entries(CANDLES).map(([id, c]) => ({ id, hasPack: c.hasPack, packSize: c.packSize ?? null })),
      colourFamilies: FAMILY_CANDLE_COLORS,
    },
    workshops: (sessions ?? [])
      .filter((s: { workshop_date: string; is_open: boolean }) => String(s.workshop_date) >= today)
      .map((s: { id: string; workshop_type: string; workshop_date: string; workshop_time: string | null; unit_price: number; max_capacity: number; is_open: boolean; remaining_seats: number }) => ({
        id: s.id,
        type: s.workshop_type,
        date: String(s.workshop_date),
        time: s.workshop_time,
        unitPrice: Number(s.unit_price),
        maxCapacity: s.max_capacity,
        isOpen: s.is_open,
        remainingSeats: s.remaining_seats,
      })),
  };
}
