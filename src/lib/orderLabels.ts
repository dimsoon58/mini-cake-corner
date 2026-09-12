// Shared, customer/admin-facing label resolution for an order_items row —
// used by both MyOrders.tsx (customer order history) and AdminOrder.tsx
// (admin order-review page reached from the notification e-mail), so the
// two never drift into two different ideas of "readable name" for the same
// stored value. Every id here is resolved against the SAME static
// catalogues already used at checkout (sizes/shapes/styles from
// @/data/customization) — no new data source, no raw id ever shown to
// either audience when a real catalogue name exists for it.
import { sizes, shapes, styles } from "@/data/customization";

export const PRODUCT_LABELS: Record<string, { en: string; fr: string }> = {
  bento_cake: { en: "Cake", fr: "Gâteau" },
  rectangle_cake: { en: "Rectangle Cake", fr: "Gâteau Rectangle" },
  dot_cakes: { en: "Dot Cakes", fr: "Dot Cakes" },
  diy_kit: { en: "DIY Kit", fr: "Kit DIY" },
  candles: { en: "Candles", fr: "Bougies" },
  edible_printing: { en: "Edible Printing", fr: "Impression Comestible" },
  workshop: { en: "Workshop", fr: "Atelier" },
};

export function formatDateCH(dateValue?: string | null): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// Raw ids are decoded against the same catalogue used at checkout wherever
// possible (sizes/shapes/styles) — falls back to a light "prettify" of the
// raw id for product lines that don't live in that catalogue (DIY Kit, Dot
// Cakes packs, Edible Printing), rather than building a second lookup table.
function prettifyId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Dot Cakes packs store their size as a dynamic "dot-cakes-<N>" id (N = pack
// size) — never in the static `sizes` catalogue, since the pack size isn't
// a fixed option. Special-cased here so it reads as "Pack of 20" instead of
// falling through to the generic prettify ("Dot Cakes 20") — this is also
// the "how many did they order" figure for a Dot Cakes line (there is no
// separate numeric quantity column for cakes — each order_items row is one
// cake, or for Dot Cakes, one whole pack of this size).
const DOT_CAKES_PACK_RE = /^dot-cakes-(\d+)$/;

export function sizeLabel(sizeId: string): string {
  const known = sizes.find((s) => s.id === sizeId)?.name;
  if (known) return known;
  const packMatch = sizeId.match(DOT_CAKES_PACK_RE);
  if (packMatch) return `Pack of ${packMatch[1]}`;
  return prettifyId(sizeId);
}

export function shapeLabel(shapeId: string): string {
  return shapes.find((s) => s.id === shapeId)?.name || prettifyId(shapeId);
}

export function designLabel(designId: string): string {
  return styles.find((s) => s.id === designId)?.name || prettifyId(designId);
}

// Catalog.tsx embeds this exact tag into item_comment for a Shag-Cake-style
// design with two option photos ("[Preferred design: Option N]"), so the
// admin invoice/email keeps seeing which photo was picked. Neither the
// customer's order history nor the admin review page should show that raw
// bracket tag as if it were part of a typed comment — split it out so the
// caller can fold it into the Design line instead ("Shag Cake — Photo 2"),
// in plain language.
const PREFERRED_DESIGN_RE = /^\[Preferred design: Option (\d+)\]\s*/;

export function splitComment(comment: string | null | undefined): { designPhoto: number | null; comment: string | null } {
  if (!comment) return { designPhoto: null, comment: null };
  const match = comment.match(PREFERRED_DESIGN_RE);
  if (!match) return { designPhoto: null, comment };
  const rest = comment.slice(match[0].length).trim();
  return { designPhoto: Number(match[1]), comment: rest || null };
}
